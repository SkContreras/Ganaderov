"""D4 races through the real authenticated RPC on disposable PostgreSQL only.

Requires the complete candidate schema (including photo_operations_d4.sql),
psycopg 3, GANADEROV_TEST_DB_URL and GANADEROV_DISPOSABLE_DB=YES.
Storage fixtures remain until the disposable database/container is discarded.
"""
import concurrent.futures
import datetime
import json
import os
import threading
import uuid

import psycopg
from psycopg.types.json import Jsonb


def main():
    if os.environ.get("GANADEROV_DISPOSABLE_DB") != "YES":
        raise SystemExit("Refusing: explicitly identify a disposable staging database")
    url = os.environ["GANADEROV_TEST_DB_URL"]
    if "vptsuhlnhtqxadztgdxn" in url:
        raise SystemExit("Known production project forbidden")
    owner = str(uuid.uuid4())
    animals = [str(uuid.uuid4()) for _ in range(4)]
    photos = {animal: [str(uuid.uuid4()) for _ in range(3)] for animal in animals}
    originals = {}

    def connect():
        connection = psycopg.connect(url)
        connection.execute("set statement_timeout='20s'")
        connection.execute("set lock_timeout='15s'")
        return connection

    def actor(connection):
        connection.execute("set local role authenticated")
        connection.execute(
            "select set_config('request.jwt.claims', %s, true)",
            (json.dumps({"sub": owner, "role": "authenticated", "email": owner + "@example.invalid"}),),
        )

    def operation(action, animal, photo, changes, revision=1):
        return {
            "protocolVersion": 1,
            "operationId": str(uuid.uuid4()),
            "deviceId": str(uuid.uuid4()),
            "ownerId": owner,
            "action": action,
            "entityId": photo,
            "baseRevision": revision,
            "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "changes": {"animalId": animal, **changes},
        }

    def send(op, barrier=None):
        with connect() as connection:
            actor(connection)
            if barrier:
                barrier.wait(timeout=10)
            return connection.execute("select public.sync_apply_operation(%s)", (Jsonb(op),)).fetchone()[0]

    def parallel(first, second):
        barrier = threading.Barrier(2)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(send, op, barrier) for op in (first, second)]
            return [future.result() for future in futures]

    def read(photo):
        with connect() as connection:
            actor(connection)
            return connection.execute("select public.sync_read_entity(%s,'photo',%s)", (owner, photo)).fetchone()[0]

    def winner(results, conflict):
        assert sorted(result["status"] for result in results) == ["applied", "conflict"], results
        won = next(index for index, result in enumerate(results) if result["status"] == "applied")
        assert results[1 - won]["code"] == conflict, results
        return won

    with connect() as connection:
        connection.execute("insert into auth.users(id,email) values(%s,%s)", (owner, owner + "@example.invalid"))
        connection.execute("insert into public.ranches(owner_id,display_name) values(%s,'D4 concurrency fixture')", (owner,))
        connection.execute(
            "insert into public.ranch_members(owner_id,user_id,display_name,role,status) values(%s,%s,'Owner','owner','active')",
            (owner, owner),
        )
        for animal in animals:
            bundle_photos = []
            for index, photo in enumerate(photos[animal]):
                metadata = {
                    "id": photo, "animalId": animal, "name": f"Original {index}", "mime": "image/jpeg",
                    "storagePath": f"{owner}/{animal}/{photo}", "primary": index == 0,
                    "createdAt": "2025-01-01T00:00:00Z", "sourceMetadata": {"orientation": 6},
                }
                originals[photo] = metadata
                bundle_photos.append(metadata)
                connection.execute(
                    "insert into storage.objects(bucket_id,name,metadata) values('animal-photos',%s,%s)",
                    (metadata["storagePath"], Jsonb({"size": 2048, "mimetype": "image/jpeg"})),
                )
            connection.execute(
                "insert into public.animal_sync_records(owner_id,animal_id,payload) values(%s,%s,%s)",
                (owner, animal, Jsonb({"animal": {"id": animal, "status": "Activo"}, "events": [], "photos": bundle_photos, "forecasts": []})),
            )

    try:
        animal = animals[0]
        first, second, third = photos[animal]
        candidates = [operation("photo.primary", animal, target, {"previousPrimaryId": first}) for target in (second, third)]
        results = parallel(*candidates)
        won = winner(results, "PRIMARY_CHANGED")
        selected, rejected = (second, third) if won == 0 else (third, second)
        assert read(selected)["data"]["primary"] is True
        assert read(rejected)["data"]["primary"] is False
        assert read(rejected)["revision"] == 1  # CAS, not a target revision change, prevents the overwrite.
        assert read(first)["revision"] == 2 and read(first)["data"]["primary"] is False
        assert send(candidates[won]) == {**results[won], "status": "duplicate"}

        animal = animals[1]
        photo = photos[animal][0]
        candidates = [operation("photo.crop", animal, photo, {"cropX": x, "cropY": y, "cropZoom": zoom})
                      for x, y, zoom in ((10, 20, 1.5), (90, 80, 2.5))]
        results = parallel(*candidates)
        won = winner(results, "REVISION_CONFLICT")
        data = read(photo)
        assert data["revision"] == 2
        assert data["data"] == {**originals[photo], **{key: value for key, value in candidates[won]["changes"].items() if key != "animalId"}}

        animal = animals[2]
        photo = photos[animal][0]
        crop = operation("photo.crop", animal, photo, {"cropX": 33, "cropY": 66, "cropZoom": 2})
        results = parallel(crop, crop)
        assert sorted(result["status"] for result in results) == ["applied", "duplicate"], results
        assert results[0]["revision"] == results[1]["revision"] == 2
        assert results[0]["serverReceivedAt"] == results[1]["serverReceivedAt"]
        assert read(photo)["revision"] == 2

        animal = animals[3]
        photo, fallback, _ = photos[animal]
        crop = operation("photo.crop", animal, photo, {"cropX": 25, "cropY": 75, "cropZoom": 2})
        delete = operation("photo.delete", animal, photo, {})
        results = parallel(crop, delete)
        assert sorted(result["status"] for result in results) == ["applied", "conflict"], results
        if results[0]["status"] == "applied":
            assert results[1]["code"] == "REVISION_CONFLICT", results
            assert read(photo)["revision"] == 2
            assert send(operation("photo.delete", animal, photo, {}, revision=2))["status"] == "applied"
            assert send(crop) == {**results[0], "status": "duplicate"}
        else:
            assert results[0]["code"] == "ENTITY_NOT_AVAILABLE", results
            assert send(crop)["code"] == "ENTITY_NOT_AVAILABLE"
        assert read(photo)["data"] is None  # A retry after deletion cannot resurrect the photo.
        assert read(fallback)["data"]["primary"] is True
        assert send(operation("photo.primary", animal, photo, {"previousPrimaryId": fallback}))["code"] == "ENTITY_NOT_AVAILABLE"

        with connect() as connection:
            rows = connection.execute(
                "select name,metadata from storage.objects where bucket_id='animal-photos' and name=any(%s)",
                ([metadata["storagePath"] for metadata in originals.values()],),
            ).fetchall()
            assert len(rows) == len(originals)
            assert all(metadata == {"size": 2048, "mimetype": "image/jpeg"} for _, metadata in rows)
            count = connection.execute(
                "select count(*) from ganaderov_private.operation_audit where owner_id=%s and request->>'action'='photo.primary'", (owner,),
            ).fetchone()[0]
            assert count == 1  # Only the CAS winner was committed/audited.
        print("PASS: distinct-primary CAS race, crop revision race, duplicate race, crop/delete race, original objects preserved")
    finally:
        # These IDs are generated by this invocation. Discard the disposable DB if cleanup fails.
        # Supabase forbids direct SQL deletion of storage.objects. Leave the
        # original-object fixtures for container disposal; they have no owner
        # column assigned and do not participate in the ranch/user cleanup.
        with connect() as connection:
            connection.execute("delete from public.animal_sync_records where owner_id=%s", (owner,))
            connection.execute("delete from ganaderov_private.event_operation_receipts where owner_id=%s", (owner,))
            connection.execute("delete from ganaderov_private.sync_changes_v1 where owner_id=%s", (owner,))
            connection.execute("delete from ganaderov_private.sync_heads_v1 where owner_id=%s", (owner,))
            connection.execute("delete from public.ranches where owner_id=%s", (owner,))
            connection.execute("delete from auth.users where id=%s", (owner,))


if __name__ == "__main__":
    main()
