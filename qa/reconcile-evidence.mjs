import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function sha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// 1. WAV Analysis
function parseWav(filePath) {
  const buf = fs.readFileSync(filePath);
  const size = buf.length;
  const riff = buf.toString('ascii', 0, 4);
  const wave = buf.toString('ascii', 8, 12);
  const fmt = buf.toString('ascii', 12, 16);
  const audioFormat = buf.readUInt16LE(20);
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const byteRate = buf.readUInt32LE(28);
  const blockAlign = buf.readUInt16LE(32);
  const bitsPerSample = buf.readUInt16LE(34);
  
  // Find data chunk
  let offset = 36;
  while (offset < buf.length - 8) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      const dataOffset = offset + 8;
      const sampleCount = Math.floor(chunkSize / (bitsPerSample / 8));
      const samples = [];
      for (let i = 0; i < sampleCount; i++) {
        samples.push(buf.readInt16LE(dataOffset + i * 2));
      }
      return {
        filePath,
        size,
        riff,
        wave,
        fmt,
        audioFormat,
        numChannels,
        sampleRate,
        byteRate,
        blockAlign,
        bitsPerSample,
        dataChunkSize: chunkSize,
        sampleCount,
        durationSeconds: sampleCount / sampleRate,
        samples,
        rawBuffer: buf
      };
    }
    offset += 8 + chunkSize;
  }
  throw new Error(`Data chunk not found in ${filePath}`);
}

function goertzel(samples, sampleRate, targetFreq) {
  const N = samples.length;
  const k = Math.round((N * targetFreq) / sampleRate);
  const omega = (2 * Math.PI * k) / N;
  const coeff = 2 * Math.cos(omega);
  let s_prev = 0;
  let s_prev2 = 0;
  for (let i = 0; i < N; i++) {
    const s = samples[i] + coeff * s_prev - s_prev2;
    s_prev2 = s_prev;
    s_prev = s;
  }
  const power = s_prev2 * s_prev2 + s_prev * s_prev - coeff * s_prev * s_prev2;
  return power / (N * N);
}

function analyzeAudio(wav) {
  const samples = wav.samples;
  const N = samples.length;
  let sumSq = 0;
  let maxAmp = 0;
  let clippedCount = 0;
  let nonZeroCount = 0;
  
  for (let i = 0; i < N; i++) {
    const s = samples[i];
    sumSq += s * s;
    const abs = Math.abs(s);
    if (abs > maxAmp) maxAmp = abs;
    if (abs >= 32760) clippedCount++;
    if (abs > 50) nonZeroCount++;
  }
  
  const rms = Math.sqrt(sumSq / N);
  const rmsDbfs = 20 * Math.log10(Math.max(1e-9, rms / 32768));
  
  const p1000 = goertzel(samples, wav.sampleRate, 1000);
  const p1500 = goertzel(samples, wav.sampleRate, 1500);
  const p440 = goertzel(samples, wav.sampleRate, 440);
  
  // Estimate noise as total energy minus tone energy
  const totalPower = sumSq / (N * 32768 * 32768); // normalized
  
  return {
    sampleCount: N,
    durationSeconds: wav.durationSeconds,
    rmsDbfs,
    maxAmp,
    clippedCount,
    clippingRatio: clippedCount / N,
    nonZeroRatio: nonZeroCount / N,
    p1000,
    p1500,
    p440,
    p1000_ratio: p1000 / (p1500 + 1e-12),
    p1500_ratio: p1500 / (p1000 + 1e-12),
  };
}

// 2. PCAP Forensic Parsing
function parsePcap(pcapPath) {
  const buf = fs.readFileSync(pcapPath);
  const magic = buf.readUInt32LE(0);
  let isLe = true;
  if (magic === 0xa1b2c3d4) isLe = true;
  else if (magic === 0xd4c3b2a1) isLe = false;
  else throw new Error(`Unknown PCAP magic: 0x${magic.toString(16)}`);
  
  const readU32 = (offset) => isLe ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
  const readU16 = (offset) => isLe ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
  
  const versionMajor = readU16(4);
  const versionMinor = readU16(6);
  const snaplen = readU32(16);
  const linkType = readU32(20); // 1 = LINKTYPE_ETHERNET, 113 = LINKTYPE_LINUX_SLL
  
  console.log(`PCAP Info: Magic=0x${magic.toString(16)}, Ver=${versionMajor}.${versionMinor}, Snaplen=${snaplen}, LinkType=${linkType}`);
  
  const packets = [];
  let offset = 24;
  
  while (offset + 16 <= buf.length) {
    const tsSec = readU32(offset);
    const tsUsec = readU32(offset + 4);
    const caplen = readU32(offset + 8);
    const origlen = readU32(offset + 12);
    offset += 16;
    
    if (offset + caplen > buf.length) break;
    const pktBuf = buf.subarray(offset, offset + caplen);
    offset += caplen;
    
    const timeEpoch = tsSec + tsUsec / 1e6;
    
    // Parse Link Layer
    let ipOffset = 0;
    if (linkType === 1) { // Ethernet
      const ethType = pktBuf.readUInt16BE(12);
      if (ethType === 0x0800) ipOffset = 14;
      else continue;
    } else if (linkType === 113) { // Linux SLL
      const ethType = pktBuf.readUInt16BE(14);
      if (ethType === 0x0800) ipOffset = 16;
      else continue;
    } else if (linkType === 276) { // Linux SLL2
      const ethType = pktBuf.readUInt16BE(0);
      if (ethType === 0x0800) ipOffset = 20;
      else continue;
    } else {
      // Default assume Ethernet or raw IP
      ipOffset = 14;
    }
    
    if (ipOffset + 20 > pktBuf.length) continue;
    
    // IPv4
    const ipVerIhl = pktBuf[ipOffset];
    const ipVer = (ipVerIhl >> 4) & 0x0f;
    const ihl = (ipVerIhl & 0x0f) * 4;
    if (ipVer !== 4) continue;
    
    const totalLen = pktBuf.readUInt16BE(ipOffset + 2);
    const proto = pktBuf[ipOffset + 9];
    const srcIp = `${pktBuf[ipOffset + 12]}.${pktBuf[ipOffset + 13]}.${pktBuf[ipOffset + 14]}.${pktBuf[ipOffset + 15]}`;
    const dstIp = `${pktBuf[ipOffset + 16]}.${pktBuf[ipOffset + 17]}.${pktBuf[ipOffset + 18]}.${pktBuf[ipOffset + 19]}`;
    
    if (proto !== 17) {
      // Not UDP (could be TCP SIP, etc.)
      continue;
    }
    
    const udpOffset = ipOffset + ihl;
    if (udpOffset + 8 > pktBuf.length) continue;
    
    const srcPort = pktBuf.readUInt16BE(udpOffset);
    const dstPort = pktBuf.readUInt16BE(udpOffset + 2);
    const udpLen = pktBuf.readUInt16BE(udpOffset + 4);
    
    const payloadOffset = udpOffset + 8;
    const payloadLen = pktBuf.length - payloadOffset;
    const payload = pktBuf.subarray(payloadOffset);
    
    packets.push({
      timeEpoch,
      tsSec,
      tsUsec,
      srcIp,
      dstIp,
      srcPort,
      dstPort,
      payloadLen,
      payload
    });
  }
  
  return packets;
}

function analyzeRtpStreams(packets) {
  // Identify RTP packets: version = 2
  const rtpPackets = [];
  const sipPackets = [];
  
  for (const p of packets) {
    if (p.srcPort === 5060 || p.dstPort === 5060) {
      sipPackets.push(p);
      continue;
    }
    
    if (p.payloadLen >= 12) {
      const v = (p.payload[0] >> 6) & 0x03;
      if (v === 2) { // RTP Version 2
        const p_bit = (p.payload[0] >> 5) & 0x01;
        const x_bit = (p.payload[0] >> 4) & 0x01;
        const cc = p.payload[0] & 0x0f;
        const m_bit = (p.payload[1] >> 7) & 0x01;
        const pt = p.payload[1] & 0x7f;
        const seq = p.payload.readUInt16BE(2);
        const rtpTs = p.payload.readUInt32BE(4);
        const ssrc = p.payload.readUInt32BE(8);
        
        rtpPackets.push({
          ...p,
          v,
          p_bit,
          x_bit,
          cc,
          m_bit,
          pt,
          seq,
          rtpTs,
          ssrc,
          ssrcHex: '0x' + ssrc.toString(16).padStart(8, '0')
        });
      }
    }
  }
  
  // Group by SSRC
  const streams = {};
  for (const rp of rtpPackets) {
    if (!streams[rp.ssrcHex]) {
      streams[rp.ssrcHex] = {
        ssrcHex: rp.ssrcHex,
        ssrc: rp.ssrc,
        srcIp: rp.srcIp,
        srcPort: rp.srcPort,
        dstIp: rp.dstIp,
        dstPort: rp.dstPort,
        payloadTypes: new Set(),
        packets: []
      };
    }
    streams[rp.ssrcHex].payloadTypes.add(rp.pt);
    streams[rp.ssrcHex].packets.push(rp);
  }
  
  // Analyze each stream
  const results = {};
  for (const [ssrcHex, stream] of Object.entries(streams)) {
    const pkts = stream.packets.sort((a, b) => a.timeEpoch - b.timeEpoch);
    const count = pkts.length;
    const firstPkt = pkts[0];
    const lastPkt = pkts[count - 1];
    const wallDuration = lastPkt.timeEpoch - firstPkt.timeEpoch;
    
    // Sort by sequence number for gap/duplicate/reorder detection
    // Handle 16-bit wraparound if any
    let minSeq = pkts[0].seq;
    let maxSeq = pkts[0].seq;
    let gaps = 0;
    let duplicates = 0;
    let outOfOrder = 0;
    
    const seqSet = new Set();
    const seqList = pkts.map(p => p.seq);
    
    for (let i = 0; i < count; i++) {
      const s = pkts[i].seq;
      if (s < minSeq) minSeq = s;
      if (s > maxSeq) maxSeq = s;
      if (seqSet.has(s)) {
        duplicates++;
      } else {
        seqSet.add(s);
      }
      
      if (i > 0) {
        const prev = pkts[i - 1].seq;
        const diff = (s - prev) & 0xffff;
        if (diff === 0) {
          // duplicate
        } else if (diff > 0 && diff < 30000) {
          if (diff > 1) {
            gaps += (diff - 1);
          }
        } else {
          outOfOrder++;
        }
      }
    }
    
    // RTP Timestamp progression
    const firstRtpTs = firstPkt.rtpTs;
    const lastRtpTs = lastPkt.rtpTs;
    const rtpTsDiff = (lastRtpTs - firstRtpTs);
    // for 8000 Hz audio, rtpTs / 8000 = media duration in seconds
    const mediaDuration = rtpTsDiff / 8000;
    
    const ptCounts = {};
    for (const p of pkts) {
      ptCounts[p.pt] = (ptCounts[p.pt] || 0) + 1;
    }
    
    results[ssrcHex] = {
      ssrcHex,
      srcSocket: `${stream.srcIp}:${stream.srcPort}`,
      dstSocket: `${stream.dstIp}:${stream.dstPort}`,
      payloadTypes: Array.from(stream.payloadTypes),
      ptCounts,
      packetCount: count,
      firstPacketTimeEpoch: firstPkt.timeEpoch,
      lastPacketTimeEpoch: lastPkt.timeEpoch,
      wallDurationSeconds: wallDuration,
      minSeq,
      maxSeq,
      expectedPackets: maxSeq - minSeq + 1,
      observedGaps: gaps,
      duplicates,
      outOfOrder,
      firstRtpTs,
      lastRtpTs,
      rtpTimestampDelta: rtpTsDiff,
      mediaDurationSeconds: mediaDuration,
      packetLossRatio: gaps / (maxSeq - minSeq + 1)
    };
  }
  
  return {
    totalPackets: packets.length,
    sipPackets: sipPackets.length,
    rtpPackets: rtpPackets.length,
    streams: results
  };
}

async function run() {
  console.log('=== EVIDENCE RECONCILIATION SCRIPT ===\n');
  
  // 1. WAV Hashes & Analysis
  const callerWavPath = path.resolve('qa/recordings/qa-caller-15f2f1d2-8ada-46a5-a9c8-405d424f552d.wav');
  const buyerWavPath = path.resolve('qa/recordings/qa-buyer-15f2f1d2-8ada-46a5-a9c8-405d424f552d.wav');
  
  console.log('1. WAV File Hashes:');
  console.log(`Caller WAV: ${callerWavPath}`);
  console.log(`  SHA256: ${sha256(callerWavPath)}`);
  console.log(`Buyer WAV:  ${buyerWavPath}`);
  console.log(`  SHA256: ${sha256(buyerWavPath)}`);
  
  const callerWav = parseWav(callerWavPath);
  const buyerWav = parseWav(buyerWavPath);
  
  const callerAnalysis = analyzeAudio(callerWav);
  const buyerAnalysis = analyzeAudio(buyerWav);
  
  console.log('\n2. WAV Independent Audio Analysis:');
  console.log('Caller WAV:');
  console.log(`  Size: ${callerWav.size} bytes, DataChunkSize: ${callerWav.dataChunkSize} bytes`);
  console.log(`  SampleRate: ${callerWav.sampleRate}, Channels: ${callerWav.numChannels}, Bits: ${callerWav.bitsPerSample}`);
  console.log(`  Samples: ${callerAnalysis.sampleCount}, Duration: ${callerAnalysis.durationSeconds.toFixed(3)}s`);
  console.log(`  RMS: ${callerAnalysis.rmsDbfs.toFixed(2)} dBFS, MaxAmp: ${callerAnalysis.maxAmp}, Clipped: ${callerAnalysis.clippedCount}`);
  console.log(`  Tone Power: 1000Hz=${callerAnalysis.p1000.toExponential(4)}, 1500Hz=${callerAnalysis.p1500.toExponential(4)}, 440Hz=${callerAnalysis.p440.toExponential(4)}`);
  console.log(`  Ratio 1500Hz / 1000Hz: ${callerAnalysis.p1500_ratio.toFixed(2)}x (1500Hz dominant: ${callerAnalysis.p1500 > callerAnalysis.p1000})`);
  
  console.log('\nBuyer WAV:');
  console.log(`  Size: ${buyerWav.size} bytes, DataChunkSize: ${buyerWav.dataChunkSize} bytes`);
  console.log(`  SampleRate: ${buyerWav.sampleRate}, Channels: ${buyerWav.numChannels}, Bits: ${buyerWav.bitsPerSample}`);
  console.log(`  Samples: ${buyerAnalysis.sampleCount}, Duration: ${buyerAnalysis.durationSeconds.toFixed(3)}s`);
  console.log(`  RMS: ${buyerAnalysis.rmsDbfs.toFixed(2)} dBFS, MaxAmp: ${buyerAnalysis.maxAmp}, Clipped: ${buyerAnalysis.clippedCount}`);
  console.log(`  Tone Power: 1000Hz=${buyerAnalysis.p1000.toExponential(4)}, 1500Hz=${buyerAnalysis.p1500.toExponential(4)}, 440Hz=${buyerAnalysis.p440.toExponential(4)}`);
  console.log(`  Ratio 1000Hz / 1500Hz: ${buyerAnalysis.p1000_ratio.toFixed(2)}x (1000Hz dominant: ${buyerAnalysis.p1000 > buyerAnalysis.p1500})`);
  
  // 2. PCAP Analysis
  console.log('\n3. PCAP File Hashes & Detailed Parsing:');
  const pcapPath = path.resolve('qa/evidence/phase-7b-10u-carrier-rtp.pcap');
  console.log(`PCAP File: ${pcapPath}`);
  console.log(`  SHA256: ${sha256(pcapPath)}`);
  
  const rawPackets = parsePcap(pcapPath);
  const pcapRes = analyzeRtpStreams(rawPackets);
  console.log(`Total Packets: ${pcapRes.totalPackets}`);
  console.log(`SIP Packets (5060): ${pcapRes.sipPackets}`);
  console.log(`RTP Packets: ${pcapRes.rtpPackets}`);
  console.log(`Streams Identified: ${Object.keys(pcapRes.streams).length}\n`);
  
  for (const [ssrcHex, s] of Object.entries(pcapRes.streams)) {
    console.log(`Stream SSRC: ${ssrcHex}`);
    console.log(`  Socket: ${s.srcSocket} -> ${s.dstSocket}`);
    console.log(`  PTs: ${s.payloadTypes.join(', ')}, Counts: ${JSON.stringify(s.ptCounts)}`);
    console.log(`  Packets: ${s.packetCount}, Wall Duration: ${s.wallDurationSeconds.toFixed(3)}s`);
    console.log(`  Start: ${new Date(s.firstPacketTimeEpoch * 1000).toISOString()}, End: ${new Date(s.lastPacketTimeEpoch * 1000).toISOString()}`);
    console.log(`  Seq Range: ${s.minSeq}..${s.maxSeq} (Expected: ${s.expectedPackets})`);
    console.log(`  Gaps: ${s.observedGaps}, Duplicates: ${s.duplicates}, OutOfOrder: ${s.outOfOrder}`);
    console.log(`  First RTP Ts: ${s.firstRtpTs}, Last RTP Ts: ${s.lastRtpTs}, Delta: ${s.rtpTimestampDelta}`);
    console.log(`  Media Duration: ${s.mediaDurationSeconds.toFixed(3)}s`);
    console.log(`  Seq-based Loss Ratio: ${s.packetLossRatio}\n`);
  }
}

run().catch(console.error);
