import fs from 'fs';

const { QaRtpClassifierService } = await import('../apps/api/dist/telephony/qa/qa-rtp-classifier.service.js');
const classifier = new QaRtpClassifierService();
const pcapBuf = fs.readFileSync('qa/recordings/phase-7b-10s-rtp.pcap');
const packets = classifier.parsePcapBuffer(pcapBuf);

console.log('Total UDP packets parsed by classifier:', packets.length);

const p10032 = packets.filter(p => p.srcPort === 10032 || p.dstPort === 10032);
console.log('Total packets on port 10032:', p10032.length);

const inbound = p10032.filter(p => p.dstPort === 10032);
const outbound = p10032.filter(p => p.srcPort === 10032);

console.log(`Inbound to 10032: ${inbound.length}, Outbound from 10032: ${outbound.length}`);

console.log('\n--- First 10 Inbound Packets to 10032 ---');
inbound.slice(0, 10).forEach((p, idx) => {
  const ts = new Date(p.timestamp).toISOString();
  console.log(`[${idx}] ${ts} ${p.srcIp}:${p.srcPort} -> ${p.dstIp}:${p.dstPort} PT=${p.rtp?.pt} Seq=${p.rtp?.seq} SSRC=0x${p.rtp?.ssrc?.toString(16)} Len=${p.len}`);
});

console.log('\n--- Last 10 Inbound Packets to 10032 ---');
inbound.slice(-10).forEach((p, idx) => {
  const ts = new Date(p.timestamp).toISOString();
  console.log(`[${idx}] ${ts} ${p.srcIp}:${p.srcPort} -> ${p.dstIp}:${p.dstPort} PT=${p.rtp?.pt} Seq=${p.rtp?.seq} SSRC=0x${p.rtp?.ssrc?.toString(16)} Len=${p.len}`);
});

console.log('\n--- All Outbound Packets from 10032 ---');
outbound.forEach((p, idx) => {
  const ts = new Date(p.timestamp).toISOString();
  console.log(`[${idx}] ${ts} ${p.srcIp}:${p.srcPort} -> ${p.dstIp}:${p.dstPort} PT=${p.rtp?.pt} Seq=${p.rtp?.seq} SSRC=0x${p.rtp?.ssrc?.toString(16)} Len=${p.len}`);
});
