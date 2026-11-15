import fs from 'fs';

const pcapBuf = fs.readFileSync('qa/recordings/phase-7b-10s-rtp.pcap');

const { QaRtpClassifierService } = await import('../apps/api/dist/telephony/qa/qa-rtp-classifier.service.js');
const classifier = new QaRtpClassifierService();
const packets = classifier.parsePcapBuffer(pcapBuf);

// Also let's extract raw SIP packets (port 5060)
let offset = 24;
const sipMessages = [];

while (offset + 16 <= pcapBuf.length) {
  const tsSec = pcapBuf.readUInt32LE(offset);
  const tsUsec = pcapBuf.readUInt32LE(offset + 4);
  const inclLen = pcapBuf.readUInt32LE(offset + 8);
  offset += 16;
  if (offset + inclLen > pcapBuf.length) break;
  const pktData = pcapBuf.subarray(offset, offset + inclLen);
  offset += inclLen;

  let ipOffset = 20; // SLL2
  if (ipOffset + 20 <= pktData.length) {
    const proto = pktData.readUInt8(ipOffset + 9);
    if (proto === 17) {
      const ihl = (pktData.readUInt8(ipOffset) & 0x0f) * 4;
      const udpOffset = ipOffset + ihl;
      if (udpOffset + 8 <= pktData.length) {
        const srcPort = pktData.readUInt16BE(udpOffset);
        const dstPort = pktData.readUInt16BE(udpOffset + 2);
        if (srcPort === 5060 || dstPort === 5060) {
          const payload = pktData.subarray(udpOffset + 8).toString('utf8');
          const firstLine = payload.split('\r\n')[0] || payload.split('\n')[0];
          const cseqLine = payload.split('\n').find(l => l.toLowerCase().startsWith('cseq:')) || '';
          const callIdLine = payload.split('\n').find(l => l.toLowerCase().startsWith('call-id:')) || '';
          sipMessages.push({
            time: new Date((tsSec + tsUsec / 1000000) * 1000).toISOString(),
            dir: `${srcPort} -> ${dstPort}`,
            firstLine: firstLine.trim(),
            cseq: cseqLine.trim(),
            callId: callIdLine.trim()
          });
        }
      }
    }
  }
}

console.log('Total SIP Messages captured:', sipMessages.length);
sipMessages.forEach((m, idx) => {
  console.log(`[${idx}] ${m.time} (${m.dir}): ${m.firstLine} | ${m.cseq}`);
});
