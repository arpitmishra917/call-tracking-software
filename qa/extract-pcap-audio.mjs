import fs from 'fs';
import path from 'path';

const { QaAudioAnalyzerService } = await import('../apps/api/dist/telephony/qa/qa-audio-analyzer.service.js');
const analyzer = new QaAudioAnalyzerService();

// G.711 mu-law decode table
const muLawToLinear = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let u = ~i;
  let t = ((u & 0x0f) << 3) + 0x84;
  t <<= ((u & 0x70) >> 4);
  muLawToLinear[i] = (u & 0x80) !== 0 ? (0x84 - t) : (t - 0x84);
}

function parsePcapRtp(buf) {
  const isLE = buf.readUInt32LE(0) === 0xa1b2c3d4;
  const linkType = isLE ? buf.readUInt32LE(20) : buf.readUInt32BE(20);
  let offset = 24;
  const streams = {
    callerInbound: [], // dstPort 10008
    buyerInbound: [],  // dstPort 10016
  };

  while (offset + 16 <= buf.length) {
    const inclLen = isLE ? buf.readUInt32LE(offset + 8) : buf.readUInt32BE(offset + 8);
    offset += 16;
    if (offset + inclLen > buf.length) break;
    const pkt = buf.subarray(offset, offset + inclLen);
    offset += inclLen;

    let ipOffset = 0;
    let ethertype = 0;
    if (linkType === 276) {
      if (pkt.length < 20 + 20 + 8) continue;
      ethertype = pkt.readUInt16BE(0);
      ipOffset = 20;
    } else if (linkType === 1) {
      if (pkt.length < 14 + 20 + 8) continue;
      ethertype = pkt.readUInt16BE(12);
      ipOffset = 14;
    }

    if (ethertype !== 0x0800) continue;
    const ipHeaderLen = (pkt[ipOffset] & 0x0f) * 4;
    const protocol = pkt[ipOffset + 9];
    if (protocol !== 17) continue;

    const udpOffset = ipOffset + ipHeaderLen;
    const srcPort = pkt.readUInt16BE(udpOffset);
    const dstPort = pkt.readUInt16BE(udpOffset + 2);
    const payloadOffset = udpOffset + 8;
    const payloadLen = inclLen - payloadOffset;

    if (payloadLen < 12 || srcPort === 5060 || dstPort === 5060) continue;
    const rtpPayload = pkt.subarray(payloadOffset);
    const version = (rtpPayload[0] >> 6) & 0x03;
    if (version !== 2) continue;

    const pt = rtpPayload[1] & 0x7f;
    const seq = rtpPayload.readUInt16BE(2);
    const rawAudio = rtpPayload.subarray(12);

    if (pt === 0 && rawAudio.length > 0) { // PCMU
      const item = { seq, pt, data: Buffer.from(rawAudio) };
      if (dstPort === 10008) streams.callerInbound.push(item);
      if (dstPort === 10016) streams.buyerInbound.push(item);
    }
  }

  // Sort by sequence number
  streams.callerInbound.sort((a, b) => a.seq - b.seq);
  streams.buyerInbound.sort((a, b) => a.seq - b.seq);
  return streams;
}

function buildWav(pcm16Buffer, sampleRate = 8000) {
  const byteRate = sampleRate * 2;
  const blockAlign = 2;
  const subChunk2Size = pcm16Buffer.length;
  const chunkSize = 36 + subChunk2Size;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);      // PCM
  header.writeUInt16LE(1, 22);      // Mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);     // Bits per sample
  header.write('data', 36);
  header.writeUInt32LE(subChunk2Size, 40);

  return Buffer.concat([header, pcm16Buffer]);
}

function decodeMuLawToPcm(packets) {
  const totalSamples = packets.reduce((acc, p) => acc + p.data.length, 0);
  const pcmBuf = Buffer.alloc(totalSamples * 2);
  let outIdx = 0;

  for (const p of packets) {
    for (let i = 0; i < p.data.length; i++) {
      const sample = muLawToLinear[p.data[i]];
      pcmBuf.writeInt16LE(sample, outIdx);
      outIdx += 2;
    }
  }
  return pcmBuf;
}

async function main() {
  console.log('=== EXTRACTING RTP AUDIO FROM PHASE 7B-10P PCAP ===\n');
  const pcapBuf = fs.readFileSync('qa/recordings/phase-7b-10p-rtp.pcap');
  const streams = parsePcapRtp(pcapBuf);

  console.log(`Stream 2 (Caller Inbound -> Asterisk port 10008): ${streams.callerInbound.length} PCMU audio packets`);
  console.log(`Stream 4 (Buyer Inbound -> Asterisk port 10016): ${streams.buyerInbound.length} PCMU audio packets`);

  // Decode Caller Inbound (receives 1500 Hz marker sent by buyer)
  const callerPcm = decodeMuLawToPcm(streams.callerInbound);
  const callerWav = buildWav(callerPcm, 8000);
  const callerOutPath = path.resolve('qa/recordings/pcap-extracted-caller-inbound.wav');
  fs.writeFileSync(callerOutPath, callerWav);
  console.log(`Saved caller inbound extracted WAV: ${callerOutPath} (${callerWav.length} bytes, ${(callerPcm.length / 16000).toFixed(2)}s)`);

  const callerAnalysis = analyzer.analyzeRecording(callerWav, { targetFreq: 1500, minSnrDb: 5.0 });
  console.log('Caller Inbound Audio Analysis (Target 1500 Hz):', JSON.stringify(callerAnalysis, null, 2));

  // Frequency discrimination on Caller Inbound
  const caller1000 = analyzer.analyzeRecording(callerWav, { targetFreq: 1000, minSnrDb: 5.0 });
  const caller440 = analyzer.analyzeRecording(callerWav, { targetFreq: 440, minSnrDb: 5.0 });
  console.log(`Caller Inbound Discrimination: 1500Hz=${callerAnalysis.snrDb.toFixed(1)}dB, 1000Hz=${caller1000.snrDb.toFixed(1)}dB, 440Hz=${caller440.snrDb.toFixed(1)}dB`);

  // Decode Buyer Inbound (receives 1000 Hz marker sent by caller)
  const buyerPcm = decodeMuLawToPcm(streams.buyerInbound);
  const buyerWav = buildWav(buyerPcm, 8000);
  const buyerOutPath = path.resolve('qa/recordings/pcap-extracted-buyer-inbound.wav');
  fs.writeFileSync(buyerOutPath, buyerWav);
  console.log(`\nSaved buyer inbound extracted WAV: ${buyerOutPath} (${buyerWav.length} bytes, ${(buyerPcm.length / 16000).toFixed(2)}s)`);

  const buyerAnalysis = analyzer.analyzeRecording(buyerWav, { targetFreq: 1000, minSnrDb: 5.0 });
  console.log('Buyer Inbound Audio Analysis (Target 1000 Hz):', JSON.stringify(buyerAnalysis, null, 2));

  // Frequency discrimination on Buyer Inbound
  const buyer1500 = analyzer.analyzeRecording(buyerWav, { targetFreq: 1500, minSnrDb: 5.0 });
  const buyer440 = analyzer.analyzeRecording(buyerWav, { targetFreq: 440, minSnrDb: 5.0 });
  console.log(`Buyer Inbound Discrimination: 1000Hz=${buyerAnalysis.snrDb.toFixed(1)}dB, 1500Hz=${buyer1500.snrDb.toFixed(1)}dB, 440Hz=${buyer440.snrDb.toFixed(1)}dB`);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
