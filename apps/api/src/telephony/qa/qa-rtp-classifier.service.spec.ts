import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { QaRtpClassifierService } from './qa-rtp-classifier.service.js';

describe('QaRtpClassifierService', () => {
  const service = new QaRtpClassifierService();
  const pcapPath = path.resolve(process.cwd(), 'qa/recordings/phase-7b-10o-rtp.pcap');

  it('correctly parses and classifies all four directions from live Phase 7B-10O PCAP', () => {
    if (!fs.existsSync(pcapPath)) {
      console.warn('Skipping live pcap test: file not found');
      return;
    }

    const result = service.classifyPcap(pcapPath, {
      callerLocalPort: 10036,
      buyerLocalPort: 10046,
    });

    expect(result.totalPacketsParsed).toBe(839);
    expect(result.sipPacketsCount).toBe(27);
    expect(result.allFourDirectionsVerified).toBe(true);
    expect(result.unverifiedDirections).toHaveLength(0);

    // Direction 1: Caller Outbound (Asterisk -> Telnyx)
    expect(result.callerOutbound.sourcePort).toBe(10036);
    expect(result.callerOutbound.destPort).toBe(22956);
    expect(result.callerOutbound.rtpPackets).toBe(107);
    expect(result.callerOutbound.payloadTypes).toEqual([0, 13]);
    expect(result.callerOutbound.ssrc).toContain('0x30225c60');
    expect(result.callerOutbound.isMediaPresent).toBe(true);

    // Direction 2: Caller Inbound (Telnyx -> Asterisk)
    expect(result.callerInbound.sourcePort).toBe(22956);
    expect(result.callerInbound.destPort).toBe(10036);
    expect(result.callerInbound.rtpPackets).toBe(308);
    expect(result.callerInbound.audioPackets).toBe(308);
    expect(result.callerInbound.payloadTypes).toEqual([0]);
    expect(result.callerInbound.ssrc).toContain('0x7ffd5111');
    expect(result.callerInbound.isMediaPresent).toBe(true);

    // Direction 3: Buyer Outbound (Asterisk -> Telnyx)
    expect(result.buyerOutbound.sourcePort).toBe(10046);
    expect(result.buyerOutbound.destPort).toBe(28406);
    expect(result.buyerOutbound.rtpPackets).toBe(106);
    expect(result.buyerOutbound.payloadTypes).toEqual([0, 13]);
    expect(result.buyerOutbound.ssrc).toContain('0x46e3785c');
    expect(result.buyerOutbound.isMediaPresent).toBe(true);

    // Direction 4: Buyer Inbound (Telnyx -> Asterisk)
    expect(result.buyerInbound.sourcePort).toBe(28406);
    expect(result.buyerInbound.destPort).toBe(10046);
    expect(result.buyerInbound.rtpPackets).toBe(289);
    expect(result.buyerInbound.audioPackets).toBe(289);
    expect(result.buyerInbound.payloadTypes).toEqual([0]);
    expect(result.buyerInbound.ssrc).toContain('0x331c8a96');
    expect(result.buyerInbound.isMediaPresent).toBe(true);
  });

  it('rejects invalid or truncated PCAP buffer shorter than 24 bytes', () => {
    const invalidBuf = Buffer.alloc(10);
    expect(() => service.parsePcapBuffer(invalidBuf)).toThrow(/Invalid PCAP buffer/);
  });

  it('rejects buffer with invalid PCAP magic header', () => {
    const invalidBuf = Buffer.alloc(30);
    invalidBuf.writeUInt32LE(0x12345678, 0);
    expect(() => service.parsePcapBuffer(invalidBuf)).toThrow(/Invalid PCAP magic/);
  });

  it('reports unverified directions when pcap has zero media packets', () => {
    // Generate empty PCAP (just standard 24-byte header)
    const emptyPcap = Buffer.alloc(24);
    emptyPcap.writeUInt32LE(0xa1b2c3d4, 0); // Magic LE
    emptyPcap.writeUInt16LE(2, 4);          // Version major
    emptyPcap.writeUInt16LE(4, 6);          // Version minor
    emptyPcap.writeUInt32LE(0, 8);          // Zone
    emptyPcap.writeUInt32LE(0, 12);         // Sigfigs
    emptyPcap.writeUInt32LE(65535, 16);     // Snaplen
    emptyPcap.writeUInt32LE(1, 20);         // Linktype (Ethernet)

    const result = service.classifyPcap(emptyPcap);
    expect(result.totalPacketsParsed).toBe(0);
    expect(result.allFourDirectionsVerified).toBe(false);
    expect(result.unverifiedDirections).toHaveLength(4);
  });
});
