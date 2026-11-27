#!/usr/bin/env python3
"""Real Supabase Auth + PostgREST + Storage verification; disposable targets only.

No SQL, SDK mocks, production endpoint, invitation emails, or paid provisioning.
Admin credentials provision/remove only generated Auth users. Product requests
use real password-login JWTs or the restricted, revocable background capability.
The photo gateway alone uses its server-side Storage credential.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zlib

PRODUCTION_REF = "vptsuhlnhtqxadztgdxn"
HERE = Path(__file__).resolve().parent


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(value, stream, indent=2)


def target_config():
    check(os.environ.get("GANADEROV_DISPOSABLE_DB") == "YES", "Set GANADEROV_DISPOSABLE_DB=YES for a disposable target")
    path = os.environ.get("GANADEROV_SUPABASE_STATUS")
    status = json.loads(Path(path).read_text()) if path else {}
    url = os.environ.get("SUPABASE_URL", status.get("API_URL", "")).rstrip("/")
    client = os.environ.get("SUPABASE_ANON_KEY", status.get("ANON_KEY", status.get("PUBLISHABLE_KEY", "")))
    admin = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", status.get("SERVICE_ROLE_KEY", status.get("SECRET_KEY", "")))
    parsed = urllib.parse.urlsplit(url)
    check(parsed.scheme in ("http", "https") and parsed.hostname and not parsed.username and not parsed.password
          and not parsed.query and not parsed.path and not parsed.fragment,
          "Use the exact Supabase API origin")
    check(PRODUCTION_REF not in parsed.hostname.lower(), "Known production project is forbidden")
    local = parsed.hostname in ("127.0.0.1", "localhost", "::1")
    allowed = os.environ.get("GANADEROV_ALLOWED_STAGING_HOST", "")
    check(local or parsed.scheme == "https" and parsed.hostname == allowed and allowed,
          "Nonlocal targets require an explicitly selected GANADEROV_ALLOWED_STAGING_HOST")
    check(client and admin and client != admin, "Separate client and admin keys are required")
    project_ref = None
    if not local:
        match = re.fullmatch(r"([a-z0-9]{20})\.supabase\.co", parsed.hostname)
        check(match is not None, "Hosted APK profiles require an exact Supabase project origin")
        project_ref = match.group(1)
    return {"url": url, "client": client, "admin": admin, "local": local, "projectRef": project_ref}


class Api:
    def __init__(self, config):
        self.config = config

    def request(self, method, path, payload=None, token=None, admin=False, raw=None, headers=None):
        key = self.config["admin"] if admin else self.config["client"]
        request_headers = {"apikey": key, **(headers or {})}
        # Legacy local keys are JWTs. Modern secret keys authenticate through apikey.
        if token or admin and key.count(".") == 2:
            request_headers["Authorization"] = "Bearer " + (token or key)
        body = raw
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode()
            request_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.config["url"] + path, data=body, method=method, headers=request_headers)
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        data = response.read()
        try:
            decoded = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            decoded = None
        return response.status, decoded, data

    def json(self, method, path, **kwargs):
        status, data, _ = self.request(method, path, **kwargs)
        check(200 <= status < 300, f"{method} {path.split('?')[0]} returned HTTP {status}; code={data.get('code') if isinstance(data,dict) else None}")
        return data

    def rpc(self, account, name, arguments):
        return self.json("POST", "/rest/v1/rpc/" + name, payload=arguments, token=account["token"])

    def background_photo(self, capability, operation, content, mime="image/png"):
        boundary = "ganaderov-" + secrets.token_hex(16)
        parts = []
        for name, value in (("capability", capability), ("operation", json.dumps(operation, separators=(",", ":")))):
            parts.append(("--" + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + "\r\n").encode())
        parts.append(("--" + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="original.png"\r\nContent-Type: ' + mime + "\r\n\r\n").encode())
        parts.extend((content, ("\r\n--" + boundary + "--\r\n").encode()))
        return self.request("POST", "/functions/v1/sync-background-photo", raw=b"".join(parts),
                            headers={"Content-Type": "multipart/form-data; boundary=" + boundary})


def png_fixture():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    width, height = 96, 48
    pixels = b"".join(b"\0" + b"".join(bytes((20 + x * 2, 40 + y * 3, 90)) for x in range(width)) for y in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


class Suite:
    def __init__(self, config, out):
        self.api = Api(config)
        self.config, self.out = config, out
        self.run_id = uuid.uuid4().hex[:12]
        self.accounts, self.entities, self.uploads, self.results = {}, {}, [], []
        self.today = dt.datetime.now(dt.timezone.utc).date()
        self.original = png_fixture()

    def case(self, name, function):
        start = time.monotonic()
        try:
            function()
        except Exception as error:
            self.results.append({"case": name, "status": "failed", "error": str(error), "seconds": round(time.monotonic() - start, 3)})
            print("FAIL", name, str(error), flush=True)
            raise
        self.results.append({"case": name, "status": "passed", "seconds": round(time.monotonic() - start, 3)})
        print("PASS", name, flush=True)

    def operation(self, actor, action, entity_id, changes, revision=None, owner=None):
        return {"protocolVersion": 1, "operationId": str(uuid.uuid4()), "deviceId": str(uuid.uuid4()),
                "ownerId": owner or self.accounts["ownerA"]["id"], "action": action, "entityId": entity_id,
                "baseRevision": revision, "capturedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "changes": changes}

    def send(self, actor, action, entity_id, changes, revision=None, owner=None, expected="applied", code="OK", op=None):
        op = op or self.operation(actor, action, entity_id, changes, revision, owner)
        result = self.api.rpc(actor, "sync_apply_operation", {"p_operation": op})
        check(result["status"] == expected and result["code"] == code, f"{action}: expected {expected}/{code}, got {result}")
        return result

    def read(self, actor, kind, entity_id, owner=None):
        return self.api.rpc(actor, "sync_read_entity", {"p_owner": owner or self.accounts["ownerA"]["id"], "p_kind": kind, "p_id": entity_id})

    def setup(self):
        self.api.json("GET", "/auth/v1/health")
        for role in ("ownerA", "ownerB", "worker"):
            email = f"d234-{self.run_id}-{role.lower()}@example.invalid"
            password = secrets.token_urlsafe(32)
            user = self.api.json("POST", "/auth/v1/admin/users", admin=True,
                                 payload={"email": email, "password": password, "email_confirm": True})
            # Keep fixture identity even if subsequent login fails, so cleanup is scoped.
            self.accounts[role] = {"id": user["id"], "email": email, "password": password}
            session = self.api.json("POST", "/auth/v1/token?grant_type=password", payload={"email": email, "password": password})
            self.accounts[role]["token"] = session["access_token"]
            check(self.api.json("GET", "/auth/v1/user", token=session["access_token"])["id"] == user["id"], "Real Auth user mismatch")
        for role in ("ownerA", "ownerB"):
            self.api.rpc(self.accounts[role], "create_my_ranch", {"p_ranch_name": f"D234 {self.run_id} {role}", "p_display_name": role})
        owner, worker = self.accounts["ownerA"], self.accounts["worker"]
        context = self.api.rpc(owner, "get_my_ranch_context", {})
        self.api.rpc(worker, "request_ranch_access", {"p_join_code": context["join_code"], "p_display_name": "Worker fixture"})
        context = self.api.rpc(owner, "get_my_ranch_context", {})
        request_id = next(row["id"] for row in context["requests"] if row["requester_id"] == worker["id"])
        self.api.rpc(owner, "review_ranch_access_request", {"p_request_id": request_id, "p_approve": True})
        check(self.api.rpc(worker, "get_my_ranch_context", {})["role"] == "worker", "Worker membership was not granted")
        for role, names in (("ownerA", ("forecast", "journeyA", "journeyB", "journeyC", "photos", "browser", "mobile")), ("ownerB", ("isolated",))):
            actor = self.accounts[role]
            animals = {}
            for name in names:
                animal = str(uuid.uuid4()); animals[name] = animal
                self.send(actor, "animal.create", animal, {"fields": {"tag": f"{name}-{self.run_id}", "name": f"D234 {name} {self.run_id}", "sex": "Hembra"}}, owner=actor["id"])
            self.entities[role] = {"ownerId": actor["id"], "animals": animals, "photos": [], "browserPhotos": [], "mobilePhotos": []}
        for purpose, field in (("photos", "photos"), ("browser", "browserPhotos"), ("mobile", "mobilePhotos")):
            animal = self.entities["ownerA"]["animals"][purpose]
            for index in range(3):
                photo = str(uuid.uuid4()); path = f"{owner['id']}/{animal}/{photo}"
                self.api.json("POST", "/storage/v1/object/animal-photos/" + path, token=owner["token"], raw=self.original,
                              headers={"Content-Type": "image/png", "x-upsert": "false"})
                self.uploads.append(path)
                self.send(owner, "photo.create", photo, {"animalId": animal, "name": f"Original {index + 1}.png", "mime": "image/png"})
                self.entities["ownerA"][field].append({"id": photo, "animalId": animal, "storagePath": path, "sha256": hashlib.sha256(self.original).hexdigest()})

    def isolation(self):
        owner, other, worker = (self.accounts[key] for key in ("ownerA", "ownerB", "worker"))
        animal = self.entities["ownerA"]["animals"]["photos"]
        photo = self.entities["ownerA"]["photos"][0]
        self.send(other, "photo.crop", photo["id"], {"animalId": animal, "cropX": 1, "cropY": 1, "cropZoom": 2}, 1,
                  expected="rejected", code="MEMBERSHIP_REQUIRED")
        rows = self.api.json("GET", "/rest/v1/animal_sync_records?select=animal_id&owner_id=eq." + owner["id"], token=other["token"])
        check(rows == [], "PostgREST leaked the other ranch")
        for actor in (other, None):
            status, _, body = self.api.request("GET", "/storage/v1/object/authenticated/animal-photos/" + photo["storagePath"], token=actor["token"] if actor else None)
            check(status >= 400 and body != self.original, "Storage original readable without ranch membership")
        status, _, body = self.api.request("GET", "/storage/v1/object/authenticated/animal-photos/" + photo["storagePath"], token=worker["token"])
        check(status == 200 and body == self.original, "Worker could not read its ranch original")
        status, _, _ = self.api.request("POST", "/storage/v1/object/animal-photos/" + owner["id"] + "/" + animal + "/" + str(uuid.uuid4()),
                                        token=worker["token"], raw=self.original, headers={"Content-Type": "image/png", "x-upsert": "false"})
        check(status >= 400, "Worker could upload a photo")
        status, _, _ = self.api.request("POST", "/rest/v1/rpc/sync_apply_operation", payload={"p_operation": self.operation(owner, "photo.delete", photo["id"], {"animalId": animal}, 1)})
        check(status in (401, 403), "Anonymous RPC was executable")
        status, _, _ = self.api.request("GET", "/rest/v1/operation_audit?select=operation_id", token=owner["token"])
        check(status >= 400, "Private audit table was exposed by PostgREST")

    def forecasts(self):
        owner, worker = self.accounts["ownerA"], self.accounts["worker"]
        animal = self.entities["ownerA"]["animals"]["forecast"]
        forecast, event = str(uuid.uuid4()), str(uuid.uuid4())
        changes = {"animalId": animal, "baselineWeight": 300, "baselineDate": str(self.today - dt.timedelta(days=7)), "gainKgPerDay": 1, "days": 7}
        self.send(worker, "forecast.create", str(uuid.uuid4()), changes, expected="rejected", code="PERMISSION_DENIED")
        self.send(owner, "forecast.create", str(uuid.uuid4()), {**changes, "predictedWeight": 999}, expected="rejected", code="INVALID_REQUEST")
        self.send(owner, "forecast.create", forecast, changes)
        data = self.read(owner, "forecast", forecast)["data"]
        check(data["predictedWeight"] == 307 and data["targetDate"] == str(self.today) and data["source"] == "manual-gmd", "Server forecast calculation/provenance differs")
        self.send(worker, "event.create", event, {"animalId": animal, "type": "weight", "date": str(self.today), "weight": 309})
        evaluated = self.read(owner, "forecast", forecast)
        check(evaluated["data"]["status"] == "evaluated" and evaluated["data"]["actualEventId"] == event and evaluated["data"]["errorKg"] == 2, "Weight did not evaluate forecast atomically")
        self.send(worker, "event.update", event, {"animalId": animal, "weight": 311}, 1)
        check(self.read(owner, "forecast", forecast) == evaluated, "Historical forecast was silently re-evaluated after correction")
        self.send(owner, "forecast.delete", forecast, {"animalId": animal}, 1, expected="conflict", code="REVISION_CONFLICT")
        self.send(owner, "forecast.delete", forecast, {"animalId": animal}, evaluated["revision"])
        check(self.read(owner, "forecast", forecast)["data"] is None, "Forecast delete did not leave a tombstone")
        for minimum, maximum in ((350, 300), (None, 300)):
            self.send(owner, "animal.target.update", animal, {"minimum": minimum, "maximum": maximum}, 1, expected="rejected", code="INVALID_TARGET")
        self.send(owner, "animal.target.update", animal, {"minimum": 300, "maximum": 350}, 1)
        self.send(owner, "animal.target.update", animal, {"minimum": 310, "maximum": 360}, 1, expected="conflict", code="REVISION_CONFLICT")
        self.send(owner, "animal.target.update", animal, {"minimum": None, "maximum": None}, 2)
        check("targetWeightMin" not in self.read(owner, "animal", animal)["data"], "Target clear retained a bound")

    def journeys(self):
        owner, worker = self.accounts["ownerA"], self.accounts["worker"]
        animals = self.entities["ownerA"]["animals"]
        a, b, c = (animals[key] for key in ("journeyA", "journeyB", "journeyC"))
        custom = str(uuid.uuid4())
        changes = {"animalIds": [a], "type": "other", "name": "Revisión de corral", "date": str(self.today)}
        self.send(worker, "journey.create", str(uuid.uuid4()), changes, expected="rejected", code="PERMISSION_DENIED")
        self.send(owner, "journey.create", custom, changes)
        self.send(worker, "journey.attend", custom, {"animalId": a}, 1, expected="rejected", code="PERMISSION_DENIED")
        self.send(owner, "journey.attend", custom, {"animalId": a, "weight": 300}, 1, expected="rejected", code="INVALID_WEIGHT")
        journey = str(uuid.uuid4())
        self.send(owner, "journey.create", journey, {"animalIds": [a, b], "type": "weight", "date": str(self.today)})
        ops = [(owner, self.operation(owner, "journey.attend", journey, {"animalId": a, "weight": 300}, 1)),
               (worker, self.operation(worker, "journey.attend", journey, {"animalId": b, "weight": 320}, 1))]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            replies = list(pool.map(lambda pair: self.api.rpc(pair[0], "sync_apply_operation", {"p_operation": pair[1]}), ops))
        check(all(reply["status"] == "applied" for reply in replies), "Independent stale journey attendance failed to merge")
        version = self.read(owner, "journey", journey)["revision"]
        self.send(owner, "journey.add_animals", journey, {"animalIds": [a]}, version, expected="conflict", code="ALREADY_IN_ROSTER")
        self.send(owner, "journey.add_animals", journey, {"animalIds": [c]}, version)
        version = self.read(owner, "journey", journey)["revision"]
        self.send(owner, "journey.finish", journey, {"allowIncomplete": False}, version, expected="rejected", code="INVALID_REQUEST")
        check(self.read(owner, "event", "journey:" + journey + ":" + a)["data"] is None, "Rejected finish partially wrote animal events")
        receipt = self.send(owner, "journey.finish", journey, {"allowIncomplete": True}, version)
        check(self.read(owner, "journey", journey)["data"]["status"] == "incomplete", "Incomplete finish lost pending roster")
        self.send(owner, "journey.resume", journey, {}, receipt["revision"])
        version = self.read(owner, "journey", journey)["revision"]
        self.send(worker, "journey.attend", journey, {"animalId": c, "weight": 330}, version)
        version = self.read(owner, "journey", journey)["revision"]
        operation = self.operation(owner, "journey.finish", journey, {"allowIncomplete": False}, version)
        receipt = self.send(owner, "journey.finish", journey, {}, op=operation)
        duplicate = self.send(owner, "journey.finish", journey, {}, op=operation, expected="duplicate")
        check(duplicate == {**receipt, "status": "duplicate"}, "Finish retry changed its original receipt")
        for animal in (a, b, c):
            event = self.read(owner, "event", "journey:" + journey + ":" + animal)["data"]
            check(event["animalId"] == animal and event["journeyId"] == journey, "Journey event parent mismatch")

    def photos(self):
        owner = self.accounts["ownerA"]
        first, second, third = self.entities["ownerA"]["photos"]
        animal = first["animalId"]
        before = self.read(owner, "photo", first["id"])["data"]
        crop = self.operation(owner, "photo.crop", first["id"], {"animalId": animal, "cropX": 17, "cropY": 81, "cropZoom": 2.2}, 1)
        receipt = self.send(owner, "photo.crop", first["id"], {}, op=crop)
        check(self.send(owner, "photo.crop", first["id"], {}, op=crop, expected="duplicate") == {**receipt, "status": "duplicate"}, "Lost-response replay was not idempotent")
        after = self.read(owner, "photo", first["id"])["data"]
        check({k: v for k, v in after.items() if k not in ("cropX", "cropY", "cropZoom")} == before, "Crop changed source metadata")
        ops = [self.operation(owner, "photo.primary", photo["id"], {"animalId": animal, "previousPrimaryId": first["id"]}, 1) for photo in (second, third)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            replies = list(pool.map(lambda operation: self.api.rpc(owner, "sync_apply_operation", {"p_operation": operation}), ops))
        check(sorted(r["status"] for r in replies) == ["applied", "conflict"] and any(r["code"] == "PRIMARY_CHANGED" for r in replies), "Primary CAS did not survive independent HTTP requests")
        pending = self.operation(owner, "photo.crop", first["id"], {"animalId": animal, "cropX": 50, "cropY": 50, "cropZoom": 1}, 2)
        self.send(owner, "photo.crop", first["id"], {}, op=pending, expected="conflict", code="REVISION_CONFLICT")
        version = self.read(owner, "photo", first["id"])["revision"]
        self.send(owner, "photo.delete", first["id"], {"animalId": animal}, version)
        self.send(owner, "photo.crop", first["id"], {}, op=pending, expected="conflict", code="ENTITY_NOT_AVAILABLE")
        for photo in (first, second, third):
            status, _, data = self.api.request("GET", "/storage/v1/object/authenticated/animal-photos/" + photo["storagePath"], token=owner["token"])
            check(status == 200 and hashlib.sha256(data).hexdigest() == photo["sha256"], "Metadata edit/delete changed original file bytes")

    def universal_completion(self):
        actor = self.accounts["ownerB"]
        animal, event = str(uuid.uuid4()), str(uuid.uuid4())
        self.send(actor, "animal.create", animal, {"fields": {"tag": "completion-" + self.run_id}}, owner=actor["id"])
        snapshot = self.read(actor, "animal", animal, actor["id"])
        check(re.fullmatch(r"ANM-\d{5,}", snapshot["data"].get("internalId", "")), "Server did not assign internal ID")
        self.send(actor, "event.create", event, {"animalId": animal, "type": "note", "date": str(self.today), "notes": "Initial"},
                  owner=actor["id"])
        self.send(actor, "event.update", event, {"animalId": animal, "notes": "Corrected", "date": str(self.today - dt.timedelta(days=1)),
                                               "reason": "Correct the recorded observation"}, 1, owner=actor["id"])
        note = self.read(actor, "event", event, actor["id"])
        check(note["data"]["notes"] == "Corrected" and note["data"]["type"] == "note"
              and note["data"]["updatedBy"]["authUserId"] == actor["id"], "Extended event editor did not preserve authenticated provenance")
        self.send(actor, "event.update", event, {"animalId": animal, "notes": "No reason"}, 2, owner=actor["id"],
                  expected="rejected", code="INVALID_REQUEST")
        config = {"schemaVersion": 1, "modules": {}, "fields": {}, "layout": {}}
        self.send(actor, "config.update", actor["id"], {"config": config}, 0, owner=actor["id"])
        batch = self.api.rpc(actor, "sync_read_entities", {"p_owner": actor["id"], "p_entities": [
            {"kind": "animal", "id": animal}, {"kind": "event", "id": event}, {"kind": "config", "id": actor["id"]}]})
        check([row["revision"] for row in batch] == [1, 2, 1], "Batch revisions are not independent entity versions")
        check(batch[1]["data"] == note["data"], "Batch snapshot differs from canonical entity")
        status, _, _ = self.api.request("POST", "/rest/v1/rpc/sync_read_entities", token=self.accounts["ownerA"]["token"],
                                       payload={"p_owner": actor["id"], "p_entities": [{"kind": "animal", "id": animal}]})
        check(status in (401, 403), "Batch revision prefetch leaked another ranch")
        self.background_animal = animal

    def background_capabilities(self):
        actor, device = self.accounts["ownerB"], str(uuid.uuid4())
        issue = lambda: self.api.rpc(actor, "sync_issue_background_capability",
                                     {"p_owner": actor["id"], "p_device": device, "p_ttl_seconds": 3600})
        cap = issue()
        check(re.fullmatch(r"[0-9a-f]{64}", cap["capability"]) and cap["actorId"] == actor["id"]
              and cap["ownerId"] == actor["id"] and cap["deviceId"] == device and len(cap["allowedActions"]) == 20,
              "Background issuance returned an invalid scope")
        issued = dt.datetime.fromisoformat(cap["issuedAt"].replace("Z", "+00:00"))
        expires = dt.datetime.fromisoformat(cap["expiresAt"].replace("Z", "+00:00"))
        check(0 < (expires - issued).total_seconds() <= 3600, "Background delegation exceeded requested TTL")
        operation = self.operation(actor, "animal.create", str(uuid.uuid4()), {"fields": {"tag": "background-" + self.run_id}}, owner=actor["id"])
        operation["deviceId"] = device
        deliver = lambda token, op: self.api.request("POST", "/rest/v1/rpc/sync_apply_background_operation",
                                                    payload={"p_capability": token, "p_operation": op})
        status, _, _ = deliver("0" * 64, operation)
        check(status == 401, "Invalid background capability was accepted")
        for changed in ({**operation, "ownerId": self.accounts["ownerA"]["id"]}, {**operation, "deviceId": str(uuid.uuid4())}):
            status, _, _ = deliver(cap["capability"], changed)
            check(status == 403, "Background scope was transferable to another ranch or device")
        status, receipt, _ = deliver(cap["capability"], operation)
        check(status == 200 and receipt["status"] == "applied", "Anonymous capability delivery did not apply")
        status, duplicate, _ = deliver(cap["capability"], operation)
        check(status == 200 and duplicate == {**receipt, "status": "duplicate"}, "Capability retry changed the immutable receipt")
        status, reused, _ = deliver(cap["capability"], {**operation, "changes": {"fields": {"tag": "different"}}})
        check(status == 200 and reused["status"] == "conflict" and reused["code"] == "OPERATION_ID_REUSED", "Capability accepted changed request under the same UUID")
        applied = self.read(actor, "animal", operation["entityId"], actor["id"])
        check(applied["data"]["createdBy"]["authUserId"] == actor["id"], "Background delivery forged/lost the actor")
        # Independent concurrent HTTP requests exercise the server's ranch ID allocator.
        operations = [self.operation(actor, "animal.create", str(uuid.uuid4()), {"fields": {"tag": "concurrent-" + str(i) + "-" + self.run_id}}, owner=actor["id"]) for i in range(2)]
        for op in operations:
            op["deviceId"] = device
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda op: deliver(cap["capability"], op), operations))
        check(all(status == 200 and result["status"] == "applied" for status, result, _ in results), "Concurrent background creates failed")
        ids = [self.read(actor, "animal", op["entityId"], actor["id"])["data"]["internalId"] for op in operations]
        check(len(set(ids)) == 2, "Concurrent server internal IDs collided")
        status, _, _ = self.api.request("POST", "/rest/v1/rpc/sync_issue_background_capability", token=actor["token"],
                                       payload={"p_owner": actor["id"], "p_device": device, "p_ttl_seconds": 21601})
        check(status == 400, "Oversized capability lifetime accepted")
        # Rotation revokes the old token without exposing either token in reports.
        renewed = issue()
        status, body, _ = deliver(cap["capability"], operation)
        check(status == 401 and body.get("message") == "BACKGROUND_REVOKED", "Capability rotation did not revoke the old token")
        self.api.rpc(actor, "sync_revoke_background_capability", {"p_capability_id": renewed["capabilityId"]})
        status, _, _ = deliver(renewed["capability"], operation)
        check(status == 401, "Authenticated capability revocation failed")
        renewed = issue()
        self.api.json("POST", "/rest/v1/rpc/sync_revoke_background_token", payload={"p_capability": renewed["capability"]})
        status, _, _ = deliver(renewed["capability"], operation)
        check(status == 401, "Offline-logout token revocation failed")
        self.background_capability = issue()
        self.background_device = device
        # Preserve an active worker token to verify current membership after revocation.
        worker = self.accounts["worker"]
        self.worker_background = self.api.rpc(worker, "sync_issue_background_capability",
                                              {"p_owner": self.accounts["ownerA"]["id"], "p_device": str(uuid.uuid4())})
        forbidden = self.operation(worker, "animal.create", str(uuid.uuid4()), {"fields": {"tag": "forbidden"}})
        forbidden["deviceId"] = self.worker_background["deviceId"]
        status, _, _ = deliver(self.worker_background["capability"], forbidden)
        check(status == 403, "Worker capability escalated to manager actions")

    def background_uploads(self):
        actor, cap = self.accounts["ownerB"], self.background_capability
        photo = str(uuid.uuid4())
        operation = self.operation(actor, "photo.create", photo,
                                   {"animalId": self.background_animal, "name": "background.png", "mime": "image/png"}, owner=actor["id"])
        operation["deviceId"] = cap["deviceId"]
        path = actor["id"] + "/" + self.background_animal + "/" + photo
        self.uploads.append(path)  # Retain cleanup ownership even after a partial success.
        status, receipt, _ = self.api.background_photo(cap["capability"], operation, self.original)
        check(status == 200 and receipt.get("status") == "applied", f"Background photo gateway failed: HTTP {status}, code={receipt.get('code') if isinstance(receipt,dict) else None}")
        status, duplicate, _ = self.api.background_photo(cap["capability"], operation, self.original)
        check(status == 200 and duplicate == {**receipt, "status": "duplicate"}, "Background photo retry did not preserve its receipt")
        status, changed, _ = self.api.background_photo(cap["capability"], operation, self.original + b"changed")
        check(status == 200 and changed.get("status") == "conflict" and changed.get("code") == "BACKGROUND_UPLOAD_CONFLICT", "Same photo operation accepted different bytes")
        status, _, body = self.api.request("GET", "/storage/v1/object/authenticated/animal-photos/" + path, token=actor["token"])
        check(status == 200 and body == self.original, "Gateway overwrote original bytes")
        status, _, _ = self.api.background_photo(cap["capability"], operation, b"not an image")
        check(status == 400, "Gateway accepted non-image bytes")
        status, _, _ = self.api.background_photo(cap["capability"], operation, self.original + b"x" * (10 * 1024 * 1024))
        check(status in (400, 413), "Gateway accepted an oversized image")
        invalid_path = {**operation, "operationId": str(uuid.uuid4()), "entityId": "../escape"}
        status, _, _ = self.api.background_photo(cap["capability"], invalid_path, self.original)
        check(status == 400, "Gateway accepted a noncanonical Storage path")
        # A preexisting object is never overwritten even before metadata exists.
        collision_photo = str(uuid.uuid4())
        collision = self.operation(actor, "photo.create", collision_photo,
                                   {"animalId": self.background_animal, "name": "collision.png", "mime": "image/png"}, owner=actor["id"])
        collision["deviceId"] = cap["deviceId"]
        collision_path = actor["id"] + "/" + self.background_animal + "/" + collision_photo
        self.uploads.append(collision_path)
        self.api.json("POST", "/storage/v1/object/animal-photos/" + collision_path, token=actor["token"],
                      raw=self.original + b"existing", headers={"Content-Type": "image/png", "x-upsert": "false"})
        status, result, _ = self.api.background_photo(cap["capability"], collision, self.original)
        check(status == 200 and result.get("status") == "conflict" and result.get("code") == "PHOTO_BYTES_CONFLICT",
              "Gateway failed to reject a conflicting original object")
        check(self.read(actor, "photo", collision_photo, actor["id"])["data"] is None, "Conflicting upload wrote metadata")
        # A live Auth session is required even while the delegated token is fresh.
        self.api.json("POST", "/auth/v1/logout?scope=local", token=actor["token"])
        status, body, _ = self.api.request("POST", "/rest/v1/rpc/sync_apply_background_operation",
                                         payload={"p_capability": cap["capability"], "p_operation": operation})
        check(status == 401 and body.get("message") == "BACKGROUND_SESSION_ENDED", "Logged-out session retained delegated authorization")

    def revocation(self):
        owner, worker = self.accounts["ownerA"], self.accounts["worker"]
        animal = self.entities["ownerA"]["animals"]["forecast"]
        queued = self.operation(worker, "event.create", str(uuid.uuid4()), {"animalId": animal, "type": "weight", "date": str(self.today), "weight": 321})
        self.api.rpc(owner, "revoke_ranch_worker", {"p_user_id": worker["id"]})
        self.send(worker, "event.create", queued["entityId"], {}, op=queued, expected="rejected", code="MEMBERSHIP_REQUIRED")
        # Reuse the still-valid Auth JWT; authorization must check current membership.
        photo = self.entities["ownerA"]["browserPhotos"][0]
        status, _, _ = self.api.request("GET", "/storage/v1/object/authenticated/animal-photos/" + photo["storagePath"], token=worker["token"])
        check(status >= 400, "Revoked worker retained Storage access through an old JWT")
        if hasattr(self, "worker_background"):
            queued["deviceId"] = self.worker_background["deviceId"]
            status, body, _ = self.api.request("POST", "/rest/v1/rpc/sync_apply_background_operation",
                                             payload={"p_capability": self.worker_background["capability"], "p_operation": queued})
            check(status == 403 and body.get("message") == "BACKGROUND_MEMBERSHIP_REQUIRED",
                  "Background capability retained revoked ranch membership")

    def save_fixtures(self):
        accounts = {role: {k: v for k, v in user.items() if k != "token"} for role, user in self.accounts.items()}
        private_json(self.out / "fixtures.private.json", {"disposable": True, "runId": self.run_id, "apiUrl": self.config["url"], "clientKey": self.config["client"], "accounts": accounts, "entities": self.entities})
        client_config = {"profile": "local" if self.config["local"] else "hosted", "url": self.config["url"],
                         "publishableKey": self.config["client"], "backendReady": any(r["case"].startswith("D4") and r["status"] == "passed" for r in self.results)}
        if not self.config["local"]:
            client_config["projectRef"] = self.config["projectRef"]
        private_json(self.out / "client-config.json", client_config)

    def cleanup(self):
        # Actual Storage API, never SQL deletion or disabled protection. Only this run's paths.
        for role in ("ownerA", "ownerB"):
            owner = self.accounts.get(role, {})
            paths = [path for path in self.uploads if path.startswith(owner.get("id", "") + "/")]
            if paths and owner.get("token"):
                self.api.json("DELETE", "/storage/v1/object/animal-photos", payload={"prefixes": paths}, token=owner["token"])
        for actor in reversed(list(self.accounts.values())):
            if actor.get("token"):
                self.api.request("POST", "/auth/v1/logout", token=actor["token"])
            self.api.json("DELETE", "/auth/v1/admin/users/" + actor["id"], admin=True)

    def run(self, keep):
        try:
            self.case("Setup: real Auth logins, two ranches, approved worker and Storage uploads", self.setup)
            self.case("Access: JWT, PostgREST RLS, private schema and Storage isolation", self.isolation)
            self.case("D2: server forecast calculation, frozen evaluation, stale deletion and target CAS", self.forecasts)
            self.case("D3: custom permissions, concurrent attendance, additions, incomplete/resume/finish", self.journeys)
            self.case("D4: uploaded original, HTTP primary CAS, replay, stale/deleted target and bytes", self.photos)
            self.case("Universal completion: event corrections, config CAS, server IDs and batch revisions", self.universal_completion)
            self.case("Background: scoped anonymous delivery, immutable retries, TTL and revocation", self.background_capabilities)
            self.case("Background: real photo gateway, original integrity, retry and ended Auth session", self.background_uploads)
            self.case("Offline authorization: revoked membership with the original Auth JWT", self.revocation)
            if keep:
                self.save_fixtures()
        finally:
            self.out.mkdir(parents=True, exist_ok=True)
            (self.out / "http-report.json").write_text(json.dumps({"runId": self.run_id, "apiOrigin": self.config["url"], "cases": self.results,
                "fixturesRetained": keep, "browserExecuted": False}, indent=2))
            if not keep:
                self.cleanup()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep-fixtures", action="store_true", help="Retain generated users/files for real browser tests; discard the disposable target afterward")
    parser.add_argument("--output", type=Path, default=HERE / "runtime")
    args = parser.parse_args()
    Suite(target_config(), args.output).run(args.keep_fixtures)


if __name__ == "__main__":
    main()
