import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  describe('Authentication (MOCK)', () => {
    it('/protected (GET) - Unauthenticated API request is rejected (401)', () => {
      return request(app.getHttpServer()).get('/protected').expect(401);
    });

    it('/protected (GET) - Invalid/malformed bearer token is rejected (401)', () => {
      return request(app.getHttpServer())
        .get('/protected')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
