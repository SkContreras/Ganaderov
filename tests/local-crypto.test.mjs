import test from "node:test";
import assert from "node:assert/strict";
import {seal,unseal} from "../sync/local-crypto.mjs";
test("AES-GCM rejects cross-account and corrupted ciphertext",async()=>{
 const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
 const data={weight:350};
 const encrypted=await seal(key,"account-a",data);
 assert.deepEqual(await unseal(key,"account-a",encrypted),data);
 await assert.rejects(unseal(key,"account-b",encrypted));
 new Uint8Array(encrypted.body)[0]^=1;
 await assert.rejects(unseal(key,"account-a",encrypted));
});
