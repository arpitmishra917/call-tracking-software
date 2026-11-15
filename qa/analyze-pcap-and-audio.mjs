import fs from 'fs';
import path from 'path';

// Parse PCAP file format (libpcap 2.4 format)
const pcapPath = 'qa/recordings/phase-7b-10o-rtp.pcap';
const buf = fs.readFileSync(pcapPath);

// PCAP Header is 24 bytes
const magic = buf.readUInt32LE(0);
const isLE = magic === 0xa1b2c3d4;
console.log(`PCAP Magic: 0x${magic.toString(16)}, LittleEndian: ${isLE}`);

let offset = 24;
const packets = [];

while (offset < buf.length) {
  if (offset + 16 > buf.length) break;
  const ts_sec = isLE ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
  const ts_usec = isLE ? buf.readUInt32LE(offset + 4) : buf.readUInt32BE(offset + 4);
  const incl_len = isLE ? buf.readUInt32LE(offset + 8) : buf.readUInt32BE(offset + 8);
  const orig_len = isLE ? buf.readUInt32LE(offset + 12) : buf.readUInt32BE(offset + 12);
  offset += 16;

  if (offset + incl_len > buf.length) break;
  const pktData = buf.subarray(offset, offset + incl_len);
  offset += incl_len;

  // Ethernet header is 14 bytes: dst(6), src(6), ethertype(2)
  if (pktData.length < 14 + 20 + 8) continue;
  const ethertype = pktData.readUInt16BE(12);
  if (ethertype !== 0x0800) continue; // IPv4 only

  // IPv4 header (starts at 14)
  const ipHeaderLen = (pktData[14] & 0x0f) * 4;
  const protocol = pktData[23]; // UDP is 17
  if (protocol !== 17) continue;

  const srcIp = `${pktData[26]}.${pktData[27]}.${pktData[28]}.${pktData[29]}`;
  const dstIp = `${pktData[30]}.${pktData[31]}.${pktData[32]}.${pktData[33]}`;

  const udpOffset = 14 + ipHeaderLen;
  const srcPort = pktData.readUInt16BE(udpOffset);
  const dstPort = pktData.readUInt16BE(udpOffset + 2);
  const udpLen = pktData.readUInt16BE(udpOffset + 4);

  const payloadOffset = udpOffset + 8;
  const payloadLen = incl_len - payloadOffset;
  const payload = pktData.subarray(payloadOffset);

  // If payload >= 12, inspect RTP
  let rtp = null;
  if (payloadLen >= 12 && (srcPort !== 5060 && dstPort !== 5060)) {
    const v_p_x_cc = payload[0];
    const version = (v_p_x_cc >> 6) & 0x03;
    if (version === 2) {
      const pt = payload[1] & 0x7f;
      const marker = (payload[1] >> 7) & 0x01;
      const seq = payload.readUInt16BE(2);
      const timestamp = payload.readUInt32BE(4);
      const ssrc = payload.readUInt32BE(8);
      rtp = { pt, marker, seq, timestamp, ssrc, payloadBytes: payloadLen - 12 };
    }
  }

  packets.push({
    ts: ts_sec + ts_usec / 1000000,
    ts_sec,
    ts_usec,
    srcIp,
    srcPort,
    dstIp,
    dstPort,
    len: payloadLen,
    rtp,
  });
}

console.log(`Total packets parsed from pcap: ${packets.length}`);

// Classify streams
const flows = {
  callerOut: packets.filter(p => p.srcPort === 10036 && p.dstPort === 22956),
  callerIn: packets.filter(p => p.srcPort === 22956 && p.dstPort === 10036),
  buyerOut: packets.filter(p => p.srcPort === 10046 && p.dstPort === 28406),
  buyerIn: packets.filter(p => p.srcPort === 28406 && p.dstPort === 10046),
  sip: packets.filter(p => p.srcPort === 5060 || p.dstPort === 5060),
};

console.log('--- Packet Flow Summary ---');
console.log(`SIP Packets (5060): ${flows.sip.length}`);
console.log(`Caller Outbound (10036 -> 50.114.149.57:22956): ${flows.callerOut.length}`);
console.log(`Caller Inbound  (50.114.149.57:22956 -> 10036): ${flows.callerIn.length}`);
console.log(`Buyer Outbound  (10046 -> 50.114.147.37:28406): ${flows.buyerOut.length}`);
console.log(`Buyer Inbound   (50.114.147.37:28406 -> 10046): ${flows.buyerIn.length}`);

function getStreamStats(stream, name) {
  if (stream.length === 0) return { name, count: 0 };
  const rtpPkts = stream.filter(p => p.rtp !== null);
  const startTs = stream[0].ts;
  const endTs = stream[stream.length - 1].ts;
  const duration = endTs - startTs;
  const ssrclist = [...new Set(rtpPkts.map(p => '0x' + p.rtp.ssrc.toString(16)))];
  const pts = [...new Set(rtpPkts.map(p => p.rtp.pt))];
  const seqs = rtpPkts.map(p => p.rtp.seq);
  const minSeq = Math.min(...seqs);
  const maxSeq = Math.max(...seqs);
  const totalBytes = stream.reduce((sum, p) => sum + p.len, 0);

  return {
    name,
    totalPackets: stream.length,
    rtpPackets: rtpPkts.length,
    ssrc: ssrclist,
    payloadTypes: pts,
    minSeq,
    maxSeq,
    durationSecs: parseFloat(duration.toFixed(3)),
    totalBytes,
    firstPacketTime: new Date(startTs * 1000).toISOString(),
    lastPacketTime: new Date(endTs * 1000).toISOString(),
    packetsPerSecond: parseFloat((rtpPkts.length / (duration || 1)).toFixed(1)),
  };
}

const stats = {
  callerOut: getStreamStats(flows.callerOut, 'Caller Outbound (Asterisk -> Telnyx)'),
  callerIn: getStreamStats(flows.callerIn, 'Caller Inbound (Telnyx -> Asterisk)'),
  buyerOut: getStreamStats(flows.buyerOut, 'Buyer Outbound (Asterisk -> Telnyx)'),
  buyerIn: getStreamStats(flows.buyerIn, 'Buyer Inbound (Telnyx -> Asterisk)'),
};

console.log('\n--- Stream Detailed Statistics ---');
console.log(JSON.stringify(stats, null, 2));

// Save analysis to disk
fs.writeFileSync('qa/recordings/phase-7b-10o-rtp-analysis.json', JSON.stringify({ flows: {
  sipCount: flows.sip.length,
  callerOutCount: flows.callerOut.length,
  callerInCount: flows.callerIn.length,
  buyerOutCount: flows.buyerOut.length,
  buyerInCount: flows.buyerIn.length,
}, stats }, null, 2));
