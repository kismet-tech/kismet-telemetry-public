'use client';
import {useState} from 'react';
export default function Page(){const [status,setStatus]=useState('');return <main><h1>Test checkout</h1><button onClick={async()=>{const r=await fetch('/app/api/confirm',{method:'POST'});setStatus(JSON.stringify(await r.json()))}}>Confirm test booking</button><output>{status}</output></main>}
