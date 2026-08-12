import axios from 'axios';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
dotenv.config();

async function main() {
  const token = jwt.sign({ id: 1, username: 'officer_test', role: 'admin' }, process.env.JWT_SECRET || 'fallback-secret-rakshak-2026', { expiresIn: '1d' });
  const client = axios.create({
    baseURL: 'http://localhost:5000',
    headers: { Authorization: `Bearer ${token}` }
  });

  console.log('--- Testing Live Server Endpoints on http://localhost:5000 ---');

  // 1. Get Cases
  try {
    const casesRes = await client.get('/api/crimeos/cases');
    console.log('GET /api/crimeos/cases response:', casesRes.data.cases?.map((c: any) => ({ id: c.id, caseNumber: c.caseNumber, title: c.title })));
    
    if (casesRes.data.cases?.length > 0) {
      const firstCase = casesRes.data.cases[0];
      const caseIdToTest = firstCase.id || firstCase.caseNumber;
      console.log('Testing PUT /api/crimeos/cases/' + caseIdToTest);
      
      try {
        const updateRes = await client.put(`/api/crimeos/cases/${caseIdToTest}`, {
          title: firstCase.title + ' (Updated)',
          status: 'ACTIVE_INVESTIGATION',
          threatLevel: 'CRITICAL',
          incidentSummary: firstCase.incidentSummary
        });
        console.log('PUT /api/crimeos/cases success:', updateRes.data);
      } catch (err: any) {
        console.error('PUT /api/crimeos/cases ERROR:', err.response?.status, err.response?.data || err.message);
      }
    }
  } catch (err: any) {
    console.error('GET /api/crimeos/cases ERROR:', err.response?.status, err.response?.data || err.message);
  }

  // 2. Get Feed & Test Delete
  try {
    const feedRes = await client.get('/api/feed?limit=10');
    const posts = feedRes.data.data || feedRes.data.feed || [];
    console.log(`GET /api/feed returned ${posts.length} posts`);
    
    if (posts.length > 0) {
      const firstPost = posts[0];
      console.log(`Testing DELETE /api/feed/${firstPost.id} (Author: @${firstPost.author})`);
      try {
        const delRes = await client.delete(`/api/feed/${firstPost.id}`);
        console.log('DELETE /api/feed success:', delRes.data);
      } catch (err: any) {
        console.error('DELETE /api/feed ERROR:', err.response?.status, err.response?.data || err.message);
      }
    }
  } catch (err: any) {
    console.error('GET /api/feed ERROR:', err.response?.status, err.response?.data || err.message);
  }

  process.exit(0);
}

main().catch(console.error);
