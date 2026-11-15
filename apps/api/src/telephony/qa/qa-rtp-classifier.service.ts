import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';

export interface RtpPacketInfo {
  timestamp: number;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  len: number;
  rtp?: {
    pt: number;
    marker: number;
    seq: number;
    timestamp: number;
    ssrc: number;
    payloadBytes: number;
  };
}

export interface StreamDirectionMetrics {
  direction: string;
  sourceIp: string;
  sourcePort: number;
  destIp: string;
  destPort: number;
  totalPackets: number;
  rtpPackets: number;
  audioPackets: number;
  comfortNoisePackets: number;
  payloadTypes: number[];
  ssrc: string[];
  minSeq: number;
  maxSeq: number;
  expectedPackets: number;
  packetLoss: number;
  lossRatio: number;
  durationSeconds: number;
  mediaDurationSeconds: number;
  firstPacketTime: string;
  lastPacketTime: string;
  totalBytes: number;
  packetsPerSecond: number;
  isMediaPresent: boolean;
}

export interface FourDirectionClassificationResult {
  totalPacketsParsed: number;
  sipPacketsCount: number;
  callerOutbound: StreamDirectionMetrics;
  callerInbound: StreamDirectionMetrics;
  buyerOutbound: StreamDirectionMetrics;
  buyerInbound: StreamDirectionMetrics;
  allFourDirectionsVerified: boolean;
  unverifiedDirections: string[];
}

@Injectable()
export class QaRtpClassifierService {
  private readonly logger = new Logger(QaRtpClassifierService.name);

  /**
   * Parses a PCAP buffer (libpcap format) into discrete IP/UDP/RTP packets.
   */
  public parsePcapBuffer(buf: Buffer): RtpPacketInfo[] {
    if (buf.length < 24) {
      throw new Error(`Invalid PCAP buffer: length ${buf.length} is less than 24-byte header`);
    }

    const magic = buf.readUInt32LE(0);
    const isLE = magic === 0xa1b2c3d4;
    const isBE = magic === 0xd4c3b2a1;

    if (!isLE && !isBE) {
      throw new Error(`Invalid PCAP magic: 0x${magic.toString(16)} (expected 0xa1b2c3d4 or 0xd4c3b2a1)`);
    }

    const linkType = isLE ? buf.readUInt32LE(20) : buf.readUInt32BE(20);

    let offset = 24;
    const packets: RtpPacketInfo[] = [];

    while (offset + 16 <= buf.length) {
      const tsSec = isLE ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
      const tsUsec = isLE ? buf.readUInt32LE(offset + 4) : buf.readUInt32BE(offset + 4);
      const inclLen = isLE ? buf.readUInt32LE(offset + 8) : buf.readUInt32BE(offset + 8);
      offset += 16;

      if (offset + inclLen > buf.length) break;
      const pktData = buf.subarray(offset, offset + inclLen);
      offset += inclLen;

      let ethertype = 0;
      let ipOffset = 0;

      if (linkType === 1) {
        // LINKTYPE_ETHERNET
        if (pktData.length < 14 + 20 + 8) continue;
        ethertype = pktData.readUInt16BE(12);
        ipOffset = 14;
      } else if (linkType === 113) {
        // LINKTYPE_LINUX_SLL
        if (pktData.length < 16 + 20 + 8) continue;
        ethertype = pktData.readUInt16BE(14);
        ipOffset = 16;
      } else if (linkType === 276) {
        // LINKTYPE_LINUX_SLL2
        if (pktData.length < 20 + 20 + 8) continue;
        ethertype = pktData.readUInt16BE(0);
        ipOffset = 20;
      } else {
        // Default assumption: Ethernet
        if (pktData.length < 14 + 20 + 8) continue;
        ethertype = pktData.readUInt16BE(12);
        ipOffset = 14;
      }

      if (ethertype !== 0x0800) continue; // IPv4 only

      const ipHeaderLen = (pktData[ipOffset] & 0x0f) * 4;
      const protocol = pktData[ipOffset + 9]; // UDP = 17
      if (protocol !== 17) continue;

      const srcIp = `${pktData[ipOffset + 12]}.${pktData[ipOffset + 13]}.${pktData[ipOffset + 14]}.${pktData[ipOffset + 15]}`;
      const dstIp = `${pktData[ipOffset + 16]}.${pktData[ipOffset + 17]}.${pktData[ipOffset + 18]}.${pktData[ipOffset + 19]}`;

      const udpOffset = ipOffset + ipHeaderLen;
      if (udpOffset + 8 > pktData.length) continue;

      const srcPort = pktData.readUInt16BE(udpOffset);
      const dstPort = pktData.readUInt16BE(udpOffset + 2);

      const payloadOffset = udpOffset + 8;
      const payloadLen = inclLen - payloadOffset;
      const payload = pktData.subarray(payloadOffset);

      let rtp: RtpPacketInfo['rtp'] | undefined;
      if (payloadLen >= 12 && srcPort !== 5060 && dstPort !== 5060) {
        const vpxcc = payload[0];
        const version = (vpxcc >> 6) & 0x03;
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
        timestamp: tsSec + tsUsec / 1000000,
        srcIp,
        srcPort,
        dstIp,
        dstPort,
        len: payloadLen,
        rtp,
      });
    }

    return packets;
  }

  /**
   * Classifies all packets in a PCAP into the four distinct telephony directions:
   * 1. Caller Outbound (Asterisk -> Telnyx)
   * 2. Caller Inbound  (Telnyx -> Asterisk)
   * 3. Buyer Outbound  (Asterisk -> Telnyx)
   * 4. Buyer Inbound   (Telnyx -> Asterisk)
   */
  public classifyPcap(
    pcapSource: string | Buffer,
    options?: {
      callerLocalPort?: number;
      buyerLocalPort?: number;
      callerPort?: number;
      buyerPort?: number;
    },
  ): FourDirectionClassificationResult {
    const buf = typeof pcapSource === 'string' ? fs.readFileSync(pcapSource) : pcapSource;
    const packets = this.parsePcapBuffer(buf);

    const sipPackets = packets.filter((p) => p.srcPort === 5060 || p.dstPort === 5060);
    const mediaPackets = packets.filter((p) => p.rtp !== undefined);

    // Identify Asterisk local RTP ports dynamically if not explicitly specified
    // Asterisk RTP ports fall in the configured 10000-10050 range and are even (RTCP uses odd ports)
    const asteriskRtpPorts = new Set<number>();
    for (const p of mediaPackets) {
      if (p.srcPort >= 10000 && p.srcPort <= 10050 && p.srcPort % 2 === 0) asteriskRtpPorts.add(p.srcPort);
      if (p.dstPort >= 10000 && p.dstPort <= 10050 && p.dstPort % 2 === 0) asteriskRtpPorts.add(p.dstPort);
    }

    const sortedPorts = Array.from(asteriskRtpPorts).sort((a, b) => a - b);
    const callerPort = options?.callerLocalPort ?? options?.callerPort ?? sortedPorts[0] ?? 10036;
    const buyerPort = options?.buyerLocalPort ?? options?.buyerPort ?? sortedPorts[1] ?? 10046;

    // Filter into 4 direction groups
    const callerOutPkts = mediaPackets.filter((p) => p.srcPort === callerPort);
    const callerInPkts = mediaPackets.filter((p) => p.dstPort === callerPort);
    const buyerOutPkts = mediaPackets.filter((p) => p.srcPort === buyerPort);
    const buyerInPkts = mediaPackets.filter((p) => p.dstPort === buyerPort);

    const callerOutbound = this.computeDirectionMetrics(callerOutPkts, 'Caller Outbound (Asterisk -> Telnyx)');
    const callerInbound = this.computeDirectionMetrics(callerInPkts, 'Caller Inbound (Telnyx -> Asterisk)');
    const buyerOutbound = this.computeDirectionMetrics(buyerOutPkts, 'Buyer Outbound (Asterisk -> Telnyx)');
    const buyerInbound = this.computeDirectionMetrics(buyerInPkts, 'Buyer Inbound (Telnyx -> Asterisk)');

    const directions = [callerOutbound, callerInbound, buyerOutbound, buyerInbound];
    const unverifiedDirections = directions.filter((d) => !d.isMediaPresent).map((d) => d.direction);
    const allFourDirectionsVerified = unverifiedDirections.length === 0;

    return {
      totalPacketsParsed: packets.length,
      sipPacketsCount: sipPackets.length,
      callerOutbound,
      callerInbound,
      buyerOutbound,
      buyerInbound,
      allFourDirectionsVerified,
      unverifiedDirections,
    };
  }

  private computeDirectionMetrics(stream: RtpPacketInfo[], directionName: string): StreamDirectionMetrics {
    if (stream.length === 0) {
      return {
        direction: directionName,
        sourceIp: '0.0.0.0',
        sourcePort: 0,
        destIp: '0.0.0.0',
        destPort: 0,
        totalPackets: 0,
        rtpPackets: 0,
        audioPackets: 0,
        comfortNoisePackets: 0,
        payloadTypes: [],
        ssrc: [],
        minSeq: 0,
        maxSeq: 0,
        expectedPackets: 0,
        packetLoss: 0,
        lossRatio: 0,
        durationSeconds: 0,
        mediaDurationSeconds: 0,
        firstPacketTime: '',
        lastPacketTime: '',
        totalBytes: 0,
        packetsPerSecond: 0,
        isMediaPresent: false,
      };
    }

    const first = stream[0];
    const last = stream[stream.length - 1];
    const duration = Math.max(0.001, last.timestamp - first.timestamp);

    let audioCount = 0;
    let cnCount = 0;
    const pts = new Set<number>();
    const ssrcs = new Set<string>();
    const seqs: number[] = [];
    let totalBytes = 0;

    for (const p of stream) {
      totalBytes += p.len;
      if (p.rtp) {
        pts.add(p.rtp.pt);
        ssrcs.add('0x' + p.rtp.ssrc.toString(16));
        seqs.push(p.rtp.seq);
        if (p.rtp.pt === 0 || p.rtp.pt === 8) {
          audioCount++;
        } else if (p.rtp.pt === 13) {
          cnCount++;
        }
      }
    }

    const minSeq = seqs.length > 0 ? Math.min(...seqs) : 0;
    const maxSeq = seqs.length > 0 ? Math.max(...seqs) : 0;
    const expectedPackets = seqs.length > 0 ? maxSeq - minSeq + 1 : 0;
    const packetLoss = Math.max(0, expectedPackets - stream.length);
    const lossRatio = expectedPackets > 0 ? packetLoss / expectedPackets : 0;

    return {
      direction: directionName,
      sourceIp: first.srcIp,
      sourcePort: first.srcPort,
      destIp: first.dstIp,
      destPort: first.dstPort,
      totalPackets: stream.length,
      rtpPackets: stream.length,
      audioPackets: audioCount,
      comfortNoisePackets: cnCount,
      payloadTypes: Array.from(pts).sort((a, b) => a - b),
      ssrc: Array.from(ssrcs),
      minSeq,
      maxSeq,
      expectedPackets,
      packetLoss,
      lossRatio: parseFloat(lossRatio.toFixed(4)),
      durationSeconds: parseFloat(duration.toFixed(3)),
      mediaDurationSeconds: parseFloat((audioCount * 0.02).toFixed(3)), // 20ms audio frames
      firstPacketTime: new Date(first.timestamp * 1000).toISOString(),
      lastPacketTime: new Date(last.timestamp * 1000).toISOString(),
      totalBytes,
      packetsPerSecond: parseFloat((stream.length / duration).toFixed(1)),
      isMediaPresent: stream.length > 0 && (audioCount > 0 || totalBytes > 1000),
    };
  }
}
