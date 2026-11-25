import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import * as React from 'react';
import {renderToString} from 'react-dom/server';
import {StaticRouter} from 'react-router-dom/server.js';
const vite = await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {AuthContext} = await vite.ssrLoadModule('/src/auth/AuthProvider.jsx');
 const {default:Portal} = await vite.ssrLoadModule('/src/pages/Portal.jsx');
 const auth={loading:false,patient:{reference:'a'.repeat(32),displayName:'Synthetic Preview Patient',email:'preview@example.test',hasPassword:true,emailVerified:true},logout:async()=>{},refresh:async()=>{},supportContact:''};
 for(const route of ['/portal','/portal/profile','/portal/appointments','/portal/account','/portal/link','/portal/appointments/'+ 'a'.repeat(32),'/portal/unknown']) {
  const html=renderToString(React.createElement(StaticRouter,{location:route},React.createElement(AuthContext.Provider,{value:auth},React.createElement(Portal))));
  assert.ok(html.includes('patient-shell'));assert.ok(html.includes('Sign out'));assert.ok(!html.includes('undefined'));
  if(route==='/portal')assert.ok(html.includes('Synthetic Preview Patient'));
  if(route==='/portal/link')assert.ok(html.includes('guest-link-code'));
  if(route==='/portal/account')assert.ok(html.includes('Active sessions'));
  if(route === '/portal' && process.argv.includes('--preview')) {
   const css=(await fs.readdir('dist/assets')).find(name=>name.endsWith('.css'));
   await fs.writeFile('dist/portal-preview.html',`<!doctype html><html><head><meta charset="UTF-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/dist/assets/${css}"><title>Synthetic portal layout check</title></head><body>${html}</body></html>`);
  }
  console.log('PASS portal render '+route);
 }
 const html=renderToString(React.createElement(StaticRouter,{location:'/portal/profile'},React.createElement(AuthContext.Provider,{value:{...auth,patient:null}},React.createElement(Portal))));
 assert.ok(!html.includes('Synthetic Preview Patient'));assert.ok(html.includes('Sign in'));
 console.log('PASS signed-out portal excludes private identity');
} finally {await vite.close();}
