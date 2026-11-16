import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { generateUsRingbackWav } from './ringback-tone.util.js';

@Controller('telephony')
export class RingbackController {
  private cachedWav: Buffer | null = null;

  @Get('ringback.wav')
  @Header('Content-Type', 'audio/wav')
  @Header('Cache-Control', 'public, max-age=86400')
  getRingbackTone(@Res() res: Response) {
    if (!this.cachedWav) {
      this.cachedWav = generateUsRingbackWav();
    }
    return res.status(200).send(this.cachedWav);
  }
}
