import { agentInvestigator } from './utils/agentInvestigator';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  console.log('================================================================');
  console.log('TESTING CRIMEOS COPILOT: ATTACHED CONTEXT & GEMINI DEEP REASONING');
  console.log('================================================================\n');

  // Test Case 1: Attaching a Crawled Reddit Threat Post
  console.log('--- 1. Testing Query with Attached Crawled Post Context ---');
  const mockPostContext = {
    type: 'crawled_post' as const,
    id: 'post-test-01',
    label: 'Post: @surat_hacker [REDDIT]',
    data: {
      id: 'post-test-01',
      source: 'reddit',
      author: 'surat_hacker',
      url: 'https://reddit.com/r/surat/comments/extortion_dump',
      publishedAt: new Date().toISOString(),
      content: 'Diamond merchants in Varachha mini bazar must transfer 2.5 BTC to our wallet before Friday or entire private transaction log will be leaked.',
      translatedContent: 'Diamond merchants in Varachha mini bazar must transfer 2.5 BTC to our wallet before Friday or entire private transaction log will be leaked.',
      threatCategory: 'cyber_crime',
      threatScore: 0.92,
      threatLabel: 'critical',
      namedEntities: { locations: ['Varachha'], organizations: ['Diamond Market'] }
    }
  };

  const query1 = 'What BNS and IT Act penal sections apply to this suspect? Outline procedural IO directives under BNSS 2023.';
  console.log(`Officer Query: "${query1}"`);
  console.log(`Attached: ${mockPostContext.label}`);

  const res1 = await agentInvestigator.processQuery(query1, 'Insp. V. K. Jadeja', undefined, [mockPostContext]);
  console.log(`\nModel Used: ${res1.modelUsed || 'Local Fallback'}`);
  console.log('\n--- Copilot Deep Reasoning Output ---');
  console.log(res1.answer.substring(0, 500) + '...\n');
  console.log('Suggested Actions:', res1.suggestedActions);

  // Test Case 2: Attaching both Crawled Post + Police Case File
  console.log('\n--- 2. Testing Query with Dual Context (Post + Case File) ---');
  const mockCaseContext = {
    type: 'case_file' as const,
    id: 'CASE-SRT-2026-081',
    label: 'Case: CASE-SRT-2026-081 (Varachha Diamond Extortion)',
    data: {
      id: 'case-081',
      caseNumber: 'CASE-SRT-2026-081',
      firNumber: 'FIR-SRT-2026-4412',
      title: 'Varachha Diamond Syndicate Extortion Threat',
      policeStation: 'Cyber Crime Branch Surat',
      investigatingOfficer: 'Insp. V. K. Jadeja',
      status: 'ACTIVE_INVESTIGATION',
      threatLevel: 'CRITICAL',
      applicableBnsSections: ['BNS 308(2) Extortion', 'BNS 351(2) Intimidation', 'IT Act 66D'],
      incidentSummary: 'Coordinated WhatsApp VoIP extortion demands targeting SEZ diamond export merchants with leaked tax assessment dumps.'
    }
  };

  const query2 = 'Synthesize the connection between this new intercepted post and our active case CASE-SRT-2026-081, and formulate the electronic evidence chain of custody protocol under Section 63 BSA 2023.';
  console.log(`Officer Query: "${query2}"`);
  console.log(`Attached: [${mockPostContext.label}, ${mockCaseContext.label}]`);

  const res2 = await agentInvestigator.processQuery(query2, 'Insp. V. K. Jadeja', undefined, [mockPostContext, mockCaseContext]);
  console.log(`\nModel Used: ${res2.modelUsed || 'Local Fallback'}`);
  console.log('\n--- Copilot Deep Reasoning Output ---');
  console.log(res2.answer.substring(0, 600) + '...\n');

  console.log('================================================================');
  console.log('✅ ALL CRIMEOS GEMINI CONTEXT ATTACHMENT TESTS COMPLETED');
  console.log('================================================================');
}

main().catch(console.error);
