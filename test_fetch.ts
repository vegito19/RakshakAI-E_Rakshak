import * as http from 'http';
import * as fs from 'fs';

function test() {
  http.get('http://localhost:5000/', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      fs.writeFileSync('c:/Users/Vineet/OneDrive/Desktop/RakshakAI-E_Rakshak/scratch_html.html', data);
      console.log("Success! Saved HTML to scratch_html.html");
    });
  }).on('error', (err) => {
    console.error("Error fetching:", err);
  });
}
test();
