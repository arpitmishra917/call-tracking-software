import http from 'http';

const USER = 'callflow_qa';
const PASS = 'cfqa_ari_1f044860de198dfa6fd829c7a40f23cbe9ae09b6';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const ARI_BASE = 'http://127.0.0.1:8088';

async function ariGet(endpoint) {
  try {
    const res = await fetch(`${ARI_BASE}${endpoint}`, {
      headers: {
        Authorization: AUTH,
        Accept: 'application/json'
      }
    });
    if (!res.ok) {
      return { status: res.status, error: await res.text().catch(() => '') };
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch (err) {
    return { error: err.message };
  }
}

async function audit() {
  console.log('=== ASTERISK ARI READ-ONLY INFRASTRUCTURE INSPECTION ===\n');
  
  // 1. Asterisk Info
  const info = await ariGet('/ari/asterisk/info');
  console.log('1. Asterisk Info Status:', info.status);
  if (info.data) {
    console.log('   Build Info:', JSON.stringify(info.data.build));
    console.log('   System Info:', JSON.stringify(info.data.system));
    console.log('   Status Info:', JSON.stringify(info.data.status));
  }
  
  // 2. Endpoints
  const endpoints = await ariGet('/ari/endpoints');
  console.log('\n2. Endpoints Status:', endpoints.status);
  if (endpoints.data) {
    console.log(`   Count: ${endpoints.data.length}`);
    endpoints.data.forEach(ep => {
      console.log(`   - Technology: ${ep.technology}, Resource: ${ep.resource}, State: ${ep.state}, Channels: [${ep.channel_ids?.join(', ') || ''}]`);
    });
  }
  
  // 3. Channels
  const channels = await ariGet('/ari/channels');
  console.log('\n3. Channels Status:', channels.status);
  if (channels.data) {
    console.log(`   Active Channels: ${channels.data.length}`);
    channels.data.forEach(ch => {
      console.log(`   - ID: ${ch.id}, Name: ${ch.name}, State: ${ch.state}`);
    });
  }
  
  // 4. Bridges
  const bridges = await ariGet('/ari/bridges');
  console.log('\n4. Bridges Status:', bridges.status);
  if (bridges.data) {
    console.log(`   Active Bridges: ${bridges.data.length}`);
    bridges.data.forEach(br => {
      console.log(`   - ID: ${br.id}, Technology: ${br.technology}, Bridge Type: ${br.bridge_type}, Channels: [${br.channels?.join(', ') || ''}]`);
    });
  }
  
  // 5. Stored Recordings
  const recordings = await ariGet('/ari/recordings/stored');
  console.log('\n5. Stored Recordings Status:', recordings.status);
  if (recordings.data) {
    console.log(`   Stored Recordings Count: ${recordings.data.length}`);
    recordings.data.slice(0, 10).forEach(rec => {
      console.log(`   - Name: ${rec.name}, Format: ${rec.format}, Duration: ${rec.duration}s`);
    });
    if (recordings.data.length > 10) {
      console.log(`   ... and ${recordings.data.length - 10} more`);
    }
  }
}

audit().catch(console.error);
