"""Real PostgreSQL concurrency tests. Disposable staging ONLY.
Run: GANADEROV_TEST_DB_URL=... GANADEROV_DISPOSABLE_DB=YES python tests/concurrency_staging.py
Requires psycopg 3, installed schema + event RPC + incremental feed. Commits fixtures.
Never use production. Prefer a freshly created local Supabase database.
"""
import os, uuid, datetime, concurrent.futures, threading, json
import psycopg
from psycopg.types.json import Jsonb

def main():
    if os.environ.get("GANADEROV_DISPOSABLE_DB") != "YES":
        raise SystemExit("Refusing: explicitly identify a disposable staging database")
    url = os.environ["GANADEROV_TEST_DB_URL"]
    if "vptsuhlnhtqxadztgdxn" in url:
        raise SystemExit("Known production project forbidden")
    owner, worker, outsider = [str(uuid.uuid4()) for _ in range(3)]
    animal = str(uuid.uuid4())
    def conn():
        c = psycopg.connect(url)
        c.execute("set statement_timeout='20s'")
        c.execute("set lock_timeout='15s'")
        return c
    def actor(c, uid):
        c.execute("set local role authenticated")
        c.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub":uid,"role":"authenticated","email":uid+"@example.invalid"}),))
    def operation(weight):
        now = datetime.datetime.now(datetime.timezone.utc)
        return {"protocolVersion":1,"operationId":str(uuid.uuid4()),"entityId":str(uuid.uuid4()),"ownerId":owner,"deviceId":str(uuid.uuid4()),"action":"event.create","baseRevision":None,"capturedAt":now.isoformat(),"changes":{"animalId":animal,"type":"weight","date":now.date().isoformat(),"weight":weight}}
    def send(p, uid=worker, barrier=None):
        with conn() as c:
            actor(c,uid)
            if barrier: barrier.wait(timeout=10)
            return c.execute("select public.sync_apply_operation(%s)",(Jsonb(p),)).fetchone()[0]
    def parallel(a,b):
        barrier=threading.Barrier(2)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            f=pool.submit(send,a,worker,barrier)
            g=pool.submit(send,b,worker,barrier)
            return f.result(),g.result()
    with conn() as c:
        for uid in (owner,worker,outsider):
            c.execute("insert into auth.users(id,email) values(%s,%s)",(uid,uid+"@example.invalid"))
        c.execute("insert into public.ranches(owner_id,display_name) values(%s,'Concurrency fixture')",(owner,))
        for uid,role in ((owner,"owner"),(worker,"worker")):
            c.execute("insert into public.ranch_members(owner_id,user_id,display_name,role,status) values(%s,%s,%s,%s,'active')",(owner,uid,role,role))
        c.execute("insert into public.animal_sync_records(owner_id,animal_id,payload) values(%s,%s,%s)",(owner,animal,Jsonb({"animal":{"id":animal,"status":"Activo"},"events":[],"photos":[],"forecasts":[]})))
    try:
        a,b=operation(300),operation(310)
        assert [x["status"] for x in parallel(a,b)]==["applied","applied"]
        p=operation(320)
        x,y=parallel(p,p)
        assert {x["status"],y["status"]}=={"applied","duplicate"}
        assert x["serverReceivedAt"]==y["serverReceivedAt"]
        assert send(p)["status"]=="duplicate"  # retry after simulated lost response
        altered={**p,"changes":{**p["changes"],"weight":321}}
        assert send(altered)["code"]=="OPERATION_ID_REUSED"
        assert send(p,outsider)["code"]=="MEMBERSHIP_REQUIRED"
        with conn() as c:
            events=c.execute("select payload->'events' from public.animal_sync_records where owner_id=%s and animal_id=%s",(owner,animal)).fetchone()[0]
            assert len(events)==3 and len({e["id"] for e in events})==3
            actor(c,owner)
            cursor=0; epoch=None
            while True:
                page=c.execute("select public.sync_pull_changes(%s,%s,%s,1)",(owner,cursor,epoch)).fetchone()[0]
                assert page["status"]=="ok"
                epoch=page["epoch"]
                for change in page["changes"]:
                    cursor+=1
                    assert change["revision"]==cursor
                assert page["nextCursor"]==cursor
                if not page["hasMore"]: break
            assert cursor==4
        with conn() as c:
            c.execute("update public.ranch_members set status='revoked' where owner_id=%s and user_id=%s",(owner,worker))
        assert send(operation(330))["code"]=="MEMBERSHIP_REQUIRED"
        print("PASS: concurrent append, duplicate, retry, UUID conflict, outsider, contiguous feed, revoked worker")
    finally:
        # All writes target only generated fixture IDs. A failed cleanup means
        # discard the disposable database, never run broad deletes.
        with conn() as c:
            c.execute("delete from public.animal_sync_records where owner_id=%s",(owner,))
            c.execute("delete from ganaderov_private.event_operation_receipts where owner_id=%s",(owner,))
            c.execute("delete from ganaderov_private.sync_changes_v1 where owner_id=%s",(owner,))
            c.execute("delete from ganaderov_private.sync_heads_v1 where owner_id=%s",(owner,))
            c.execute("delete from public.ranches where owner_id=%s",(owner,))
            c.execute("delete from auth.users where id=any(%s::uuid[])",([owner,worker,outsider],))
if __name__=="__main__": main()
