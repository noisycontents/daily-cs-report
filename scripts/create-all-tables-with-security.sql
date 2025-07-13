-- Supabase SM-CX Daily Stats 테이블 생성 (보안 정책 포함)
-- 이 SQL을 Supabase Dashboard의 SQL Editor에서 실행하세요
-- 기존 테이블이 있어도 안전하게 재생성됩니다

-- ========================================================================================
-- 0. 기존 테이블 및 정책 삭제 (안전한 재생성)
-- ========================================================================================

-- 기존 테이블이 있으면 관련 정책과 트리거까지 함께 삭제
DO $$
BEGIN
    -- 테이블이 존재하는지 확인
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sm_cx_daily_stats') THEN
        -- 정책 삭제
        DROP POLICY IF EXISTS "Enable read access for authenticated users" ON sm_cx_daily_stats;
        DROP POLICY IF EXISTS "Enable insert/update for service role" ON sm_cx_daily_stats;
        DROP POLICY IF EXISTS "Enable insert/update for anon users" ON sm_cx_daily_stats;
        
        -- 트리거 삭제
        DROP TRIGGER IF EXISTS update_sm_cx_daily_stats_updated_at ON sm_cx_daily_stats;
        
        -- 테이블 삭제
        DROP TABLE sm_cx_daily_stats;
        
        RAISE NOTICE '기존 sm_cx_daily_stats 테이블과 관련 정책/트리거 삭제 완료';
    ELSE
        RAISE NOTICE 'sm_cx_daily_stats 테이블이 존재하지 않음 - 새로 생성합니다';
    END IF;
END $$;

-- ========================================================================================
-- 1. SM-CX Daily Stats 메인 테이블 (PRD.md 기준)
-- ========================================================================================

CREATE TABLE sm_cx_daily_stats (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    
    -- 매출 관련 지표
    total_sales DECIMAL(12,2) DEFAULT 0.00,
    product_sales DECIMAL(12,2) DEFAULT 0.00,
    refund_amount DECIMAL(12,2) DEFAULT 0.00,
    coupon_usage DECIMAL(12,2) DEFAULT 0.00,
    net_sales DECIMAL(12,2) DEFAULT 0.00,
    
    -- 트래픽 관련 지표
    dau INTEGER DEFAULT 0,
    
    -- 주문 관련 지표
    order_count INTEGER DEFAULT 0,
    new_customer_orders INTEGER DEFAULT 0,
    returning_orders INTEGER DEFAULT 0,
    
    -- 회원 관련 지표
    signups INTEGER DEFAULT 0,
    signup_to_order_rate DECIMAL(5,2) DEFAULT 0.00,
    signup_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- 메타데이터
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 날짜별 고유 인덱스 (중복 방지)
CREATE UNIQUE INDEX idx_sm_cx_daily_stats_date ON sm_cx_daily_stats(date);
CREATE INDEX idx_sm_cx_daily_stats_created_at ON sm_cx_daily_stats(created_at);

-- ========================================================================================
-- 2. 업데이트 시간 자동 갱신 트리거 함수
-- ========================================================================================

-- 업데이트 시간 갱신 함수 (이미 존재할 수 있음)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- SM-CX Daily Stats 트리거
CREATE TRIGGER update_sm_cx_daily_stats_updated_at 
    BEFORE UPDATE ON sm_cx_daily_stats 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ========================================================================================
-- 3. 보안 정책 (Row Level Security) 설정
-- ========================================================================================

-- 🔒 SM-CX Daily Stats 테이블에 RLS 활성화
ALTER TABLE sm_cx_daily_stats ENABLE ROW LEVEL SECURITY;

-- 🔒 SM-CX Daily Stats 테이블 보안 정책
CREATE POLICY "Enable read access for authenticated users" ON sm_cx_daily_stats
    FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

CREATE POLICY "Enable insert/update for service role" ON sm_cx_daily_stats
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Enable insert/update for anon users" ON sm_cx_daily_stats
    FOR ALL USING (auth.role() = 'anon');

-- ========================================================================================
-- 4. 테이블 설명 추가
-- ========================================================================================

-- SM-CX Daily Stats 테이블 설명
COMMENT ON TABLE sm_cx_daily_stats IS 'SM-CX 워드프레스 일일 통계 데이터 - 매출, 주문, 회원, 트래픽 지표 포함';
COMMENT ON COLUMN sm_cx_daily_stats.date IS '데이터 수집 날짜 (YYYY-MM-DD)';
COMMENT ON COLUMN sm_cx_daily_stats.total_sales IS '매출 합계';
COMMENT ON COLUMN sm_cx_daily_stats.product_sales IS '특정 SKU 매출';
COMMENT ON COLUMN sm_cx_daily_stats.refund_amount IS '환불액 총합';
COMMENT ON COLUMN sm_cx_daily_stats.coupon_usage IS '쿠폰 사용액 총합';
COMMENT ON COLUMN sm_cx_daily_stats.net_sales IS '순판매액 (매출 - 환불 - 쿠폰)';
COMMENT ON COLUMN sm_cx_daily_stats.dau IS '순방문자수(DAU) - GA4 Data API activeUsers';
COMMENT ON COLUMN sm_cx_daily_stats.order_count IS '주문 수 (0원 상품 제외)';
COMMENT ON COLUMN sm_cx_daily_stats.new_customer_orders IS '신규회원 결제 수';
COMMENT ON COLUMN sm_cx_daily_stats.returning_orders IS '기존회원 재구매 결제 수';
COMMENT ON COLUMN sm_cx_daily_stats.signups IS '회원가입 수';
COMMENT ON COLUMN sm_cx_daily_stats.signup_to_order_rate IS '가입대비 신규회원 결제율 (%)';
COMMENT ON COLUMN sm_cx_daily_stats.signup_rate IS '회원가입율 (%)';

-- ========================================================================================
-- 5. 보안 상태 확인 쿼리
-- ========================================================================================

SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables 
WHERE tablename = 'sm_cx_daily_stats'
ORDER BY tablename;

-- ========================================================================================
-- 6. 테이블 생성 완료 메시지
-- ========================================================================================

DO $$
BEGIN
    RAISE NOTICE '✅ SM-CX Daily Stats 테이블 생성 완료!';
    RAISE NOTICE '📊 생성된 테이블: sm_cx_daily_stats';
    RAISE NOTICE '🔒 RLS 보안 정책 적용 완료';
    RAISE NOTICE '⚡ 트리거 및 인덱스 생성 완료';
    RAISE NOTICE '💡 회원가입율 계산은 애플리케이션에서 직접 처리';
END $$; 