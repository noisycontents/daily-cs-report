<?php
/**
 * Plugin Name: SM-CX Daily Stats API
 * Description: WordPress 일일 통계 데이터를 제공.
 * Version:     2.0.0
 * Author:      Alex
 */

add_action('rest_api_init', function() {
  register_rest_route('sm-cx/v1', '/daily-stats', [
    'methods'             => 'GET',
    'callback'            => 'sm_cx_return_daily_stats',
    'permission_callback' => 'sm_cx_check_permissions',
  ]);
});

function sm_cx_check_permissions() {
  // OAuth2 토큰이 있는지 확인하거나 관리자 권한 확인
  return current_user_can('manage_woocommerce') || is_user_logged_in();
}

function sm_cx_return_daily_stats() {
  // 날짜 파라미터 확인 (fetch-and-push.js에서 전달)
  $date_param = isset($_GET['date']) ? sanitize_text_field($_GET['date']) : '';
  
  if (!empty($date_param) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date_param)) {
    // 유효한 날짜 형식이면 사용
    $yesterday = $date_param;
  } else {
    // 기본값: 어제 날짜
    $yesterday = date('Y-m-d', strtotime('-1 day'));
  }
  
  // 기본 데이터 구조 (Supabase 테이블에 맞게)
  $stats = [
    'date' => $yesterday,
    'total_sales' => 0.00,
    'product_sales' => 0.00,
    'refund_amount' => 0.00,
    'coupon_usage' => 0.00,
    'net_sales' => 0.00,
    'dau' => 0,
    'order_count' => 0,
    'new_customer_orders' => 0,
    'returning_orders' => 0,
    'signups' => 0,
    'signup_to_order_rate' => 0.00,
    'signup_rate' => 0.00,
  ];

  // WooCommerce가 활성화되어 있는지 확인
  if (class_exists('WooCommerce')) {
    // 어제 주문 가져오기 (실제 사용되는 상태들)
    $orders = wc_get_orders([
      'status' => ['shipping', 'shipped', 'completed', 'refunded', 'processing'],
      'date_created' => $yesterday . '...' . $yesterday . ' 23:59:59',
      'limit' => 500 // 충분한 조회 제한
    ]);
    
    $total_sales = 0;
    $product_sales = 0;
    $coupon_usage = 0;
    $order_count = 0;
    $new_customer_orders = 0;
    $returning_orders = 0;
    
    // 주문 데이터 처리 (원래 로직 유지)
    foreach ($orders as $order) {
      $order_total = $order->get_total();
      
      // 총 주문수는 모든 주문 포함 (0원 포함)
      $order_count++;
      
      // 매출과 신규/기존 구분은 0원 초과만
      if ($order_total > 0) {
        $total_sales += $order_total;
        
        // 아이패드 매출 계산 (상품명에 "아이패드" 포함)
        $order_items = $order->get_items();
        foreach ($order_items as $item) {
          $product_name = $item->get_name();
          if (strpos(strtolower($product_name), '아이패드') !== false) {
            $line_total = $item->get_total();
            $product_sales += $line_total;
          }
        }
        
        // 쿠폰 사용액 계산 (간단한 방식)
        $coupon_usage += $order->get_total_discount();
        
        // 신규/기존 회원 구분 (처음 유료 구매인지만 확인)
        $customer_id = $order->get_customer_id();
        if ($customer_id > 0) {
          // 회원인 경우: 처음 유료 구매인지 확인
          $previous_paid_orders = wc_get_orders([
            'customer_id' => $customer_id,
            'status' => ['shipping', 'shipped', 'completed', 'refunded', 'processing'],
            'date_created' => '<' . $yesterday,
            'limit' => -1,
            'meta_query' => [
              [
                'key' => '_order_total',
                'value' => 0,
                'compare' => '>'
              ]
            ]
          ]);
          
          if (empty($previous_paid_orders)) {
            // 처음 유료 구매
            $new_customer_orders++;
          } else {
            // 이전에 유료 구매 경험 있음
            $returning_orders++;
          }
        } else {
          // 비회원 주문은 기존 고객으로 처리
          $returning_orders++;
        }
      }
    }
    
    // 환불액 계산 (원래 로직 유지)
    $refunds = wc_get_orders([
      'type' => 'shop_order_refund',
      'date_created' => $yesterday . '...' . $yesterday . ' 23:59:59',
      'limit' => -1
    ]);
    
    $refund_amount = 0;
    foreach ($refunds as $refund) {
      $refund_amount += abs($refund->get_total());
    }
    
    // 회원가입 수 계산 (korean.studymini.com 제외)
    $signups = count_users_by_date($yesterday);
    
    // 계산된 값들 설정 (쿠폰 사용액 포함)
    $stats['total_sales'] = (float)($total_sales + $coupon_usage);
    $stats['product_sales'] = (float)$product_sales; // 특정 SKU 계산은 별도 구현 필요
    $stats['refund_amount'] = (float)$refund_amount;
    $stats['coupon_usage'] = (float)$coupon_usage;
    $stats['net_sales'] = (float)($total_sales - $refund_amount);
    $stats['order_count'] = (int)$order_count;
    $stats['new_customer_orders'] = (int)$new_customer_orders;
    $stats['returning_orders'] = (int)$returning_orders;
    $stats['signups'] = (int)$signups;
    
    // 비율 계산
    if ($signups > 0) {
      $stats['signup_to_order_rate'] = (float)round(($new_customer_orders / $signups) * 100, 2);
    }
    
        // 최종 데이터 반환 (signup_rate와 dau는 fetch-and-push.js에서 추가)
    
  } else {
    // WooCommerce가 없으면 테스트 데이터 반환
    $stats['total_sales'] = 1234.56;
    $stats['order_count'] = 5;
    $stats['signups'] = 3;
  }

  return rest_ensure_response($stats);
}

function count_users_by_date($date) {
  global $wpdb;
  
  // KST 시간대 설정 - sm-cx-user-export.php와 동일한 처리
  $kst_timezone = new DateTimeZone('Asia/Seoul');
  
  // KST 기준으로 날짜 범위 계산
  $start_kst = new DateTime($date . ' 00:00:00', $kst_timezone);
  $end_kst = new DateTime($date . ' 23:59:59', $kst_timezone);
  
  // UTC로 변환해서 데이터베이스 쿼리용으로 사용
  $start_utc = $start_kst->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
  $end_utc = $end_kst->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
  
  // 기본 제외 사이트 (korean.studymini.com 항상 제외) - sm-cx-user-export.php와 동일
  $exclude_sites = ['korean.studymini.com'];
  
  // 먼저 날짜 범위에 해당하는 모든 사용자 조회
  $users = $wpdb->get_results($wpdb->prepare(
    "SELECT ID, user_registered FROM {$wpdb->users} 
     WHERE user_registered >= %s 
     AND user_registered <= %s",
    $start_utc,
    $end_utc
  ));
  
  $filtered_count = 0;
  
  // 각 사용자에 대해 사이트 필터링 적용
  foreach ($users as $user) {
    // 사용자의 가입 사이트 URL 확인
    $registered_site_url = get_user_meta($user->ID, 'registered_site_url', true);
    
    // registered_site_url이 없을 경우 다른 가능한 필드들 확인
    if (empty($registered_site_url)) {
      $site_url_keys = [
        'registered_site_url',
        'signup_site_url',
        'registration_site',
        'origin_site_url',
        'user_site_url',
        'site_origin'
      ];
      
      foreach ($site_url_keys as $key) {
        $site_url = get_user_meta($user->ID, $key, true);
        if (!empty($site_url)) {
          $registered_site_url = $site_url;
          break;
        }
      }
    }
    
    // 제외 사이트 확인
    $should_exclude = false;
    foreach ($exclude_sites as $exclude_site) {
      if (!empty($registered_site_url) && strpos($registered_site_url, $exclude_site) !== false) {
        $should_exclude = true;
        break;
      }
    }
    
    // 제외 대상이 아니면 카운트에 포함
    if (!$should_exclude) {
      $filtered_count++;
    }
  }
  
  return (int)$filtered_count;
}
