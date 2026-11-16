import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Prisma Stage 4 Schema & Configuration', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('Prisma service loads correctly', () => {
    expect(service).toBeDefined();
  });

  describe('Schema Validation (Regex/AST bypass)', () => {
    let schemaContent: string;

    beforeAll(() => {
      const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
      schemaContent = fs.readFileSync(schemaPath, 'utf8');
    });

    it('Profile model exists and maps to Supabase Auth user', () => {
      expect(schemaContent).toContain('model Profile');
      expect(schemaContent).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)/);
      // Ensure Profile model contains no raw password field (auth managed via Supabase)
      const profileBlock = schemaContent.slice(
        schemaContent.indexOf('model Profile {'),
        schemaContent.indexOf('}', schemaContent.indexOf('model Profile {')),
      );
      expect(profileBlock).not.toMatch(/\bpassword\s+String/i);
    });

    it('Workspace model exists with required fields', () => {
      expect(schemaContent).toContain('model Workspace');
      expect(schemaContent).toMatch(/name\s+String/);
      expect(schemaContent).toMatch(/slug\s+String/);
    });

    it('WorkspaceMember model exists with relationships', () => {
      expect(schemaContent).toContain('model WorkspaceMember');
      expect(schemaContent).toMatch(/workspace\s+Workspace\s+@relation/);
      expect(schemaContent).toMatch(/profile\s+Profile\s+@relation/);
    });

    it('WorkspaceMember has unique constraint to prevent duplicate memberships', () => {
      expect(schemaContent).toContain('@@unique([workspace_id, user_id])');
    });
  });
});
