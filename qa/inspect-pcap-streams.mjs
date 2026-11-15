import fs from 'fs';

const pcapBuf = fs.readFileSync('qa/evidence/phase-7b-10u-carrier-rtp.pcap');

// PCAP header is 24 bytes
let offset = 24;
const packets = [];

while (offset + 16 <= pcapBuf.length) {
  const tsSec = pcapBuf.readUInt32LE(offset);
  const tsUsec = pcapBuf.readUInt32LE(offset + 4);
  const inclLen = pcapBuf.readUInt32LE(offset + 8);
  const origLen = pcapBuf.readUInt32LE(offset + 12);
  offset += 16;
  
  if (offset + inclLen > pcapBuf.length) break;
  const pktData = pcapBuf.subarray(offset, offset + inclLen);
  offset += inclLen;
  
  // Basic IP parsing (assuming Ethernet 14 bytes or Linux cooked 16 bytes)
  let ipOffset = -1;
  if (pktData.readUInt16BE(12) === 0x0800) {
    ipOffset = 14;
  } else if (pktData.readUInt16BE(14) === 0x0800) {
    ipOffset = 16;
  }
  
  if (ipOffset !== -1 && ipOffset + 20 <= pktData.length) {
    const proto = pktData.readUInt8(ipOffset + 9);
    const srcIp = Array.from(pktData.subarray(ipOffset + 12, ipOffset + 16)).join('.');
    const dstIp = Array.from(pktData.subarray(ipOffset + 16, ipOffset + 20)).join('.');
    const ihl = (pktData.readUInt8(ipOffset) & 0x0f) * 4;
    
    if (proto === 17) { // UDP
      const udpOffset = ipOffset + ihl;
      if (udpOffset + 8 <= pktData.length) {
        const srcPort = pktData.readUInt16BE(udpOffset);
        const dstPort = pktData.readUInt16BE(udpOffset + 2);
        const payload = pktData.subarray(udpOffset + 8);
        packets.push({
          time: tsSec + tsUsec / 1000000,
          srcIp, dstIp, srcPort, dstPort,
          payloadLen: payload.length,
          payload
        });
      }
    }
  }
}

console.log('Total parsed UDP packets:', packets.length);
if (packets.length === 0) process.exit(0);

const t0 = packets[0].time;
console.log('Relative time start: 0.000s');

const streams = {};
for (const p of packets) {
  const key = `${p.srcIp}:${p.srcPort} -> ${p.dstIp}:${p.dstPort}`;
  if (!streams[key]) {
    streams[key] = { count: 0, first: p.time - t0, last: p.time - t0, bytes: 0, isSip: p.srcPort === 5060 || p.dstPort === 5060 };
  }
  streams[key].count++;
  streams[key].last = p.time - t0;
  streams[key].bytes += p.payloadLen;
}

for (const [k, v] of Object.entries(streams)) {
  console.log(`\nStream: ${k}`);
  console.log(`  Packets: ${v.count}, Bytes: ${v.bytes}`);
  console.log(`  Times: ${v.first.toFixed(3)}s -> ${v.last.toFixed(3)}s (Span: ${(v.last - v.first).toFixed(3)}s)`);
  console.log(`  SIP: ${v.isSip}`);
}
