/**
 * SM-CX Daily Stats 수집 및 Supabase 저장 스크립트
 * 
 * 기능:
 * - WordPress API에서 매출, 주문, 회원 데이터 수집
 *   ∟ total_sales: 취소 제외, 환불 포함한 총매출
 *   ∟ net_sales: 환불 차감된 순매출
 * - GA4 API에서 DAU 데이터 수집 (OAuth2 인증 사용)
 * - Supabase에서 클릭 데이터 조회
 * - signup_rate 계산
 * - 모든 데이터를 Supabase에 저장
 */

require('dotenv').config();

// Google ADC 완전 비활성화 (require 전에 실행)
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.GCLOUD_PROJECT;
delete process.env.GOOGLE_CLIENT_EMAIL;
delete process.env.GOOGLE_PRIVATE_KEY;

// Google 라이브러리 로딩 완전 차단
const originalRequire = require;
require = function(id) {
  if (id.includes('google') || id.includes('gax')) {
    throw new Error(`Google library blocked: ${id}`);
  }
  return originalRequire.apply(this, arguments);
};

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// require 복원
require = originalRequire;

/**
 * KST 기준으로 어제 날짜를 'YYYY-MM-DD' 형식으로 반환
 * 서울시간 기준으로 정확한 어제 날짜를 계산
 */
function getYesterdayKST() {
  // 현재 시간을 KST로 변환
  const nowKST = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
  
  // KST 기준 어제 계산
  const yesterdayKST = new Date(nowKST);
  yesterdayKST.setDate(yesterdayKST.getDate() - 1);
  
  // YYYY-MM-DD 형식으로 반환
  const year = yesterdayKST.getFullYear();
  const month = String(yesterdayKST.getMonth() + 1).padStart(2, '0');
  const day = String(yesterdayKST.getDate()).padStart(2, '0');
  
  const result = `${year}-${month}-${day}`;
  
  // 디버깅용 로그
  console.log(`🕐 현재 KST: ${nowKST.toLocaleString("ko-KR", {timeZone: "Asia/Seoul"})}`);
  console.log(`📅 계산된 어제 날짜: ${result}`);
  
  return result;
}

// 독립적인 GA4 클라이언트를 사용하여 DAU 데이터 수집
async function getGA4DAU(date) {
  const { spawn } = require('child_process');
  const path = require('path');
  
  return new Promise((resolve) => {
    const ga4Client = spawn('node', [
      path.join(__dirname, 'ga4-client.js'),
      date,
      process.env.GA4_PROPERTY_ID
    ], {
      env: {
        ...process.env,
        // Google ADC 완전 차단
        GOOGLE_APPLICATION_CREDENTIALS: '',
        GOOGLE_CLOUD_PROJECT: '',
        GCLOUD_PROJECT: '',
        GOOGLE_CLIENT_EMAIL: '',
        GOOGLE_PRIVATE_KEY: ''
      }
    });

    let output = '';
    let errorOutput = '';

    ga4Client.stdout.on('data', (data) => {
      output += data.toString();
    });

    ga4Client.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ga4Client.on('close', (code) => {
      if (code === 0) {
        const dau = parseInt(output.trim()) || 0;
        console.log(`📈 GA4 DAU (${date}):`, dau);
        resolve(dau);
      } else {
        console.error('❌ GA4 API 오류:', errorOutput);
        resolve(0); // 오류 시 0 반환
      }
    });
  });
}

async function getTotalClicks(supabase, date) {
  try {
    console.log(`📊 클릭 데이터 조회 중 (${date})...`);
    
    // 네이버, 구글, 메타 클릭 데이터 병렬 조회 (여러 행 허용)
    const [naverResult, googleResult, metaResult] = await Promise.all([
      supabase.from('naver_insights').select('clicks').eq('date', date),
      supabase.from('google_insights').select('clicks').eq('date', date),
      supabase.from('meta_insights').select('clicks').eq('date', date)
    ]);

    // 조회 완료

    // 클릭 수 합산 (여러 행이 있을 경우 모두 합함)
    const naverClicks = naverResult.data?.reduce((sum, row) => sum + (row.clicks || 0), 0) || 0;
    const googleClicks = googleResult.data?.reduce((sum, row) => sum + (row.clicks || 0), 0) || 0;
    const metaClicks = metaResult.data?.reduce((sum, row) => sum + (row.clicks || 0), 0) || 0;
    
    const totalClicks = naverClicks + googleClicks + metaClicks;
    
    console.log(`📊 클릭 데이터:`);
    console.log(`  - 네이버: ${naverClicks.toLocaleString()}회`);
    console.log(`  - 구글: ${googleClicks.toLocaleString()}회`);
    console.log(`  - 메타: ${metaClicks.toLocaleString()}회`);
    console.log(`  - 총 클릭: ${totalClicks.toLocaleString()}회`);
    
    return totalClicks;

  } catch (error) {
    console.error('❌ 클릭 데이터 조회 오류:', error.message);
    return 0; // 오류 시 0 반환
  }
}

async function main() {
  console.log('🚀 SM-CX Daily Stats 수집 시작...');
  
  // 0) 테스트용 날짜 설정 (비워두면 어제 날짜로 작동)
  const testDates = []; // 테스트할 날짜들 (비워두면 어제 날짜 사용)
  
  let targetDate;
  if (testDates.length > 0) {
    targetDate = testDates[0]; // 첫 번째 테스트 날짜 사용
    console.log(`📅 수집 대상 날짜: ${targetDate} (테스트 모드)`);
  } else {
    targetDate = getYesterdayKST(); // 어제 날짜 사용
    console.log(`📅 수집 대상 날짜: ${targetDate} (KST 기준 어제)`);
    console.log(`📅 현재 KST 시간: ${new Date().toLocaleString("ko-KR", {timeZone: "Asia/Seoul"})}`);
  }
  
  // 1) OAuth2 토큰 발급
  console.log('🔐 OAuth2 토큰 발급 중...');
  const tokenRes = await axios.post(
    `${process.env.WP_BASE_URL}/oauth/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.WP_CLIENT_ID,
      client_secret: process.env.WP_CLIENT_SECRET,
      scope: 'basic read_stats',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const accessToken = tokenRes.data.access_token;

  // 2) WordPress API에서 통계 데이터 수집
  console.log('📊 WordPress 통계 데이터 수집 중...');
  
  // 항상 명시적으로 날짜 파라미터 전달
  const apiUrl = `${process.env.WP_BASE_URL}/wp-json/sm-cx/v1/daily-stats?date=${targetDate}`;
  console.log(`📡 API 호출: ${apiUrl}`);
  
  const statsRes = await axios.get(
    apiUrl,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const stats = statsRes.data;

  console.log(`📅 수집 날짜: ${stats.date || targetDate}`);
  console.log(`💰 총 매출: ${stats.total_sales.toLocaleString()}원 (취소 제외, 환불 포함)`);
  console.log(`💎 순 매출: ${stats.net_sales.toLocaleString()}원 (환불 차감 후)`);
  console.log(`📱 아이패드 매출: ${stats.product_sales.toLocaleString()}원`);
  console.log(`📦 총 주문: ${stats.order_count}건`);
  console.log(`👥 회원가입: ${stats.signups}명`);

  // 3) GA4 DAU 데이터 가져오기 (명시적 날짜 사용)
  const dau = await getGA4DAU(targetDate);
  
  // 4) Supabase 클라이언트 생성
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
  );
  
  // 5) Supabase에서 클릭 데이터 가져오기 (명시적 날짜 사용)
  const totalClicks = await getTotalClicks(supabase, targetDate);
  
  // 6) signup_rate 계산
  const signupRate = totalClicks > 0 ? (stats.signups / totalClicks) * 100 : 0;
  
  // 7) 모든 데이터 합치기 (총매출은 환불 포함, 취소만 제외)
  const finalStats = {
    ...stats,
    // total_sales는 WordPress API 원래 값 사용 (취소 제외, 환불 포함)
    // net_sales는 환불 차감된 순매출
    date: targetDate,
    dau: dau,
    signup_rate: parseFloat(signupRate.toFixed(2))
  };
  
  console.log(`📈 GA4 DAU: ${finalStats.dau.toLocaleString()}명`);
  console.log(`📊 총 클릭: ${totalClicks.toLocaleString()}회`);
  console.log(`📈 회원가입율: ${finalStats.signup_rate}%`);

  // 8) Supabase에 최종 데이터 저장
  console.log('💾 Supabase에 데이터 저장 중...');
  const { data, error } = await supabase
    .from('sm_cx_daily_stats')
    .upsert(finalStats, {
      onConflict: 'date',
      ignoreDuplicates: false
    });

  if (error) {
    console.error('❌ Supabase 저장 실패:', error);
    process.exit(1);
  }
  
  console.log('✅ 데이터 수집 및 저장 완료!');
  console.log(`📊 저장된 날짜: ${finalStats.date}`);
}

main().catch(err => {
  console.error('❌ Script error:', err);
  process.exit(1);
});
