/**
 * 독립적인 GA4 데이터 수집 클라이언트
 * Google 라이브러리 없이 순수 REST API만 사용
 */

// Google ADC 완전 차단
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.GCLOUD_PROJECT;
delete process.env.GOOGLE_CLIENT_EMAIL;
delete process.env.GOOGLE_PRIVATE_KEY;

const axios = require('axios');

// Refresh Token으로 Google OAuth2 Access Token 발급
async function getGoogleAccessToken() {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  const { data } = await axios.post(tokenUrl, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return data.access_token;
}

async function getGA4DAU(date, propertyId) {
  try {
    // Access Token 발급
    const accessToken = await getGoogleAccessToken();

    // GA4 Property 경로 구성
    const propertyPath = propertyId && propertyId.startsWith('properties/')
      ? propertyId
      : `properties/${propertyId}`;

    // GA4 Data API 호출 (REST)
    const url = `https://analyticsdata.googleapis.com/v1beta/${propertyPath}:runReport`;
    const response = await axios.post(
      url,
      {
        dateRanges: [
          { startDate: date, endDate: date },
        ],
        metrics: [
          { name: 'activeUsers' },
        ],
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    // DAU 추출
    const dau = response.data.rows && response.data.rows.length > 0
      ? parseInt(response.data.rows[0].metricValues[0].value)
      : 0;
    
    return dau;

  } catch (error) {
    console.error('❌ GA4 API 오류:', error.message);
    return 0; // 오류 시 0 반환
  }
}

// CLI로 실행될 때
if (require.main === module) {
  const date = process.argv[2];
  const propertyId = process.argv[3];
  
  if (!date || !propertyId) {
    console.error('Usage: node ga4-client.js <date> <propertyId>');
    process.exit(1);
  }
  
  getGA4DAU(date, propertyId)
    .then(dau => {
      console.log(dau); // 단순히 숫자만 출력
    })
    .catch(error => {
      console.error('Error:', error.message);
      process.exit(1);
    });
}

module.exports = { getGA4DAU };
