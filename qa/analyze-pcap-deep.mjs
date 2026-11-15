import fs from 'fs';
import path from 'path';

function parsePcap(pcapPath) {
  const buf = fs.readFileSync(pcapPath);
  const isLE = buf.readUInt32LE(0) === 0xa1b2c3d4;
  const linkType = isLE ? buf.readUInt32LE(20) : buf.readUInt32BE(20);
  const readU32 = (offset) => isLE ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
  
  let offset = 24;
  const packets = [];
  while (offset + 16 <= buf.length) {
    const tsSec = readU32(offset);
    const tsUsec = readU32(offset + 4);
    const caplen = readU32(offset + 8);
    offset += 16;
    if (offset + caplen > buf.length) break;
    const pktBuf = buf.subarray(offset, offset + caplen);
    offset += caplen;
    
    let ipOffset = (linkType === 276) ? 20 : (linkType === 113 ? 16 : 14);
    if (ipOffset + 28 > pktBuf.length) continue;
    const ethType = (linkType === 276) ? pktBuf.readUInt16BE(0) : pktBuf.readUInt16BE(ipOffset - 2);
    if (ethType !== 0x0800) continue;
    
    const ihl = (pktBuf[ipOffset] & 0x0f) * 4;
    const proto = pktBuf[ipOffset + 9];
    if (proto !== 17) continue; // UDP
    
    const srcIp = `${pktBuf[ipOffset+12]}.${pktBuf[ipOffset+13]}.${pktBuf[ipOffset+14]}.${pktBuf[ipOffset+15]}`;
    const dstIp = `${pktBuf[ipOffset+16]}.${pktBuf[ipOffset+17]}.${pktBuf[ipOffset+18]}.${pktBuf[ipOffset+19]}`;
    const udpOffset = ipOffset + ihl;
    const srcPort = pktBuf.readUInt16BE(udpOffset);
    const dstPort = pktBuf.readUInt16BE(udpOffset + 2);
    const payload = pktBuf.subarray(udpOffset + 8);
    
    if (payload.length >= 12 && srcPort !== 5060 && dstPort !== 5060) {
      const v = (payload[0] >> 6) & 0x03;
      if (v === 2) {
        const pt = payload[1] & 0x7f;
        const seq = payload.readUInt16BE(2);
        const rtpTs = payload.readUInt32BE(4);
        const ssrc = payload.readUInt32BE(8);
        packets.push({
          time: tsSec + tsUsec / 1e6,
          srcIp, dstIp, srcPort, dstPort,
          pt, seq, rtpTs, ssrc,
          ssrcHex: '0x' + ssrc.toString(16).padStart(8, '0'),
          len: payload.length
        });
      }
    }
  }
  return packets;
}

const packets = parsePcap('qa/evidence/phase-7b-10u-carrier-rtp.pcap');
console.log(`Total RTP packets: ${packets.length}`);

// Group by SSRC
const bySsrc = {};
for (const p of packets) {
  if (!bySsrc[p.ssrcHex]) bySsrc[p.ssrcHex] = [];
  bySsrc[p.ssrcHex].push(p);
}

for (const [ssrcHex, pkts] of Object.entries(bySsrc)) {
  console.log(`\n==================================================`);
  console.log(`SSRC: ${ssrcHex} (${pkts[0].srcIp}:${pkts[0].srcPort} -> ${pkts[0].dstIp}:${pkts[0].dstPort})`);
  console.log(`Packet Count: ${pkts.length}`);
  
  // Sort by arrival time
  pkts.sort((a, b) => a.time - b.time);
  const startTime = pkts[0].time;
  const endTime = pkts[pkts.length - 1].time;
  console.log(`Time Range: ${startTime.toFixed(3)} .. ${endTime.toFixed(3)} (Delta: ${(endTime - startTime).toFixed(3)}s)`);
  
  // Sequence number analysis
  const seqs = pkts.map(p => p.seq);
  const minSeq = Math.min(...seqs);
  const maxSeq = Math.max(...seqs);
  const uniqueSeqs = new Set(seqs);
  console.log(`Min Seq: ${minSeq}, Max Seq: ${maxSeq}, Unique Seqs: ${uniqueSeqs.size}`);
  console.log(`Expected in span (max - min + 1): ${maxSeq - minSeq + 1}`);
  
  // Check missing sequences in span
  const missing = [];
  for (let s = minSeq; s <= maxSeq; s++) {
    if (!uniqueSeqs.has(s)) missing.push(s);
  }
  console.log(`Missing Seq Count: ${missing.length} ${missing.length > 0 ? `(Missing: ${missing.join(', ')})` : ''}`);
  
  // Check duplicates
  const dupes = pkts.length - uniqueSeqs.size;
  console.log(`Duplicate Count: ${dupes}`);
  
  // Check reordering (arrivals out of sequence)
  let reordered = 0;
  let maxSeqSeen = -1;
  for (const p of pkts) {
    if (p.seq < maxSeqSeen) {
      reordered++;
    } else {
      maxSeqSeen = p.seq;
    }
  }
  console.log(`Reordered Arrivals: ${reordered}`);
  
  // Timestamp jumps
  let tsJumps = 0;
  for (let i = 1; i < pkts.length; i++) {
    const dt = pkts[i].rtpTs - pkts[i-1].rtpTs;
    if (dt < 0 || dt > 1600) { // standard 20ms packet is 160 timestamp units @ 8kHz
      tsJumps++;
    }
  }
  console.log(`Timestamp Discontinuities (dt < 0 or dt > 1600): ${tsJumps}`);
  
  // First 5 and last 5 packets
  console.log('First 3 pkts:');
  pkts.slice(0, 3).forEach(p => console.log(`  seq=${p.seq} ts=${p.rtpTs} time=${p.time.toFixed(4)} pt=${p.pt}`));
  console.log('Last 3 pkts:');
  pkts.slice(-3).forEach(p => console.log(`  seq=${p.seq} ts=${p.rtpTs} time=${p.time.toFixed(4)} pt=${p.pt}`));
}
