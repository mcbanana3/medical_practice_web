import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {pages as routes} from "../.prerender/prerender.js";
const root=path.resolve("dist");
let pages=0,assets=0;
async function visit(dir) {
 for(const item of await fs.readdir(dir,{withFileTypes:true})) {
  const file=path.join(dir,item.name);
  if(item.isDirectory())await visit(file);
  else if(item.name.endsWith(".html")) {
   pages++;
   const html=await fs.readFile(file,"utf8");
   for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const value=match[1].split(/[?#]/)[0];
    if(!value.startsWith("/")||value.startsWith("//"))continue;
    const target=path.resolve(root,"."+decodeURIComponent(value));
    assert.ok(target.startsWith(root+path.sep)||target===root,"Asset outside build");
    // Application routes use SPA routing; check referenced files, not route URLs.
    if(!path.extname(value))continue;
    assert.ok(await fs.stat(target).then(stat=>stat.isFile()).catch(()=>false),"Missing built asset: "+value+" in "+file);
    assets++;
   }
  }
 }
}
await visit(root);
assert.equal(pages,routes.length+1);
console.log("PASS "+pages+" built HTML pages; "+assets+" local asset references");
