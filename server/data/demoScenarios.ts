/**
 * RecoverPay Pre-Configured Demo Scenarios
 * Concrete fixtures for deterministic demonstrations of all safety states.
 */

import { Customer, Payment } from '../../src/types/index.ts';

export interface DemoScenarioPair {
  payment: Payment;
  customer: Customer;
}

export function createDemoScenarios(): Record<string, DemoScenarioPair> {
  const now = new Date('2026-09-04T20:00:00.000Z');

  // Scenario A: pay_demo_transient_01 (₹2,499, BANK_SYSTEM_BUSY, allowed, recovered)
  const custA: Customer = {
    id: 'cust_demo_transient_01',
    name: 'Aarav Sharma (Demo)',
    email: 'aarav.sharma@example.com',
    contact: '+919811000001',
    lifetime_value: 1250000,
    previous_success_count: 8,
    previous_failure_count: 1,
    historical_success_rate: 0.89,
    opted_out: false,
    created_at: new Date(now.getTime() - 86400000 * 45).toISOString()
  };

  const payA: Payment = {
    id: 'pay_demo_transient_01',
    customer_id: custA.id,
    order_id: 'order_demo_transient_01',
    amount: 249900, // ₹2,499.00
    currency: 'INR',
    status: 'failed',
    failure_category: 'TRANSIENT_BANK_FAILURE',
    failure_code: 'BANK_SYSTEM_BUSY',
    failure_reason: 'Issuer switch downtime (503 Service Unavailable)',
    attempt_count: 1,
    recovery_attempts: 0,
    seconds_since_failure: 1200, // 20 mins (> 15m cooldown)
    last_attempt_at: new Date(now.getTime() - 1200 * 1000).toISOString(),
    created_at: new Date(now.getTime() - 1260 * 1000).toISOString(),
    updated_at: new Date(now.getTime() - 1200 * 1000).toISOString(),
    ground_truth_recoverable: true,
    ground_truth_best_action: 'RETRY_PAYMENT',
    ground_truth_expected_outcome: 'RECOVERED',
    ground_truth_reason: 'Transient switch overload. Retry after cooldown recovers payment.'
  };

  // Scenario B: pay_demo_persistent_02 (₹4,999, LIMIT_EXCEEDED, initial retry fails, reaches max_retries -> ESCALATE)
  const custB: Customer = {
    id: 'cust_demo_persistent_02',
    name: 'Priya Patel (Demo)',
    email: 'priya.patel@example.com',
    contact: '+919811000002',
    lifetime_value: 350000,
    previous_success_count: 2,
    previous_failure_count: 2,
    historical_success_rate: 0.50,
    opted_out: false,
    created_at: new Date(now.getTime() - 86400000 * 20).toISOString()
  };

  const payB: Payment = {
    id: 'pay_demo_persistent_02',
    customer_id: custB.id,
    order_id: 'order_demo_persistent_02',
    amount: 499900, // ₹4,999.00
    currency: 'INR',
    status: 'failed',
    failure_category: 'INSUFFICIENT_FUNDS',
    failure_code: 'LIMIT_EXCEEDED',
    failure_reason: 'Card daily transaction limit exceeded',
    attempt_count: 2,
    recovery_attempts: 1, // 1 previous recovery attempt
    seconds_since_failure: 1000, // > 900s cooldown
    last_attempt_at: new Date(now.getTime() - 1000 * 1000).toISOString(),
    created_at: new Date(now.getTime() - 1060 * 1000).toISOString(),
    updated_at: new Date(now.getTime() - 1000 * 1000).toISOString(),
    ground_truth_recoverable: false,
    ground_truth_best_action: 'ESCALATE',
    ground_truth_expected_outcome: 'PERMANENTLY_FAILED',
    ground_truth_reason: 'Persistent debit limit failure. Simulated retry fails, exhausts retries (2/2) and forces ESCALATE.'
  };

  // Scenario C: pay_demo_highvalue_03 (₹85,000, NETWORK_ERROR, opted_out = true -> Policy BLOCKED -> ESCALATE)
  const custC: Customer = {
    id: 'cust_demo_highvalue_03',
    name: 'Vikram Singhania (Demo)',
    email: 'vikram.singhania@enterprise.internal',
    contact: '+919811000003',
    lifetime_value: 45000000,
    previous_success_count: 14,
    previous_failure_count: 0,
    historical_success_rate: 1.00,
    opted_out: true, // Opted out of automated retries
    created_at: new Date(now.getTime() - 86400000 * 90).toISOString()
  };

  const payC: Payment = {
    id: 'pay_demo_highvalue_03',
    customer_id: custC.id,
    order_id: 'order_demo_highvalue_03',
    amount: 8500000, // ₹85,000.00 (> ₹50,000 automated recovery threshold)
    currency: 'INR',
    status: 'failed',
    failure_category: 'NETWORK_ERROR',
    failure_code: 'GATEWAY_TIMEOUT',
    failure_reason: 'Network gateway timeout during card authorization',
    attempt_count: 1,
    recovery_attempts: 0,
    seconds_since_failure: 1500,
    last_attempt_at: new Date(now.getTime() - 1500 * 1000).toISOString(),
    created_at: new Date(now.getTime() - 1560 * 1000).toISOString(),
    updated_at: new Date(now.getTime() - 1500 * 1000).toISOString(),
    ground_truth_recoverable: false,
    ground_truth_best_action: 'ESCALATE',
    ground_truth_expected_outcome: 'PERMANENTLY_FAILED',
    ground_truth_reason: 'High value (₹85,000) and customer opted out. Policy Engine strictly blocks automated actions.'
  };

  // Scenario E: pay_demo_captured_05 (₹1,499, status = 'captured' -> ALREADY_SUCCESSFUL -> STOP)
  const custE: Customer = {
    id: 'cust_demo_captured_05',
    name: 'Neha Roy (Demo)',
    email: 'neha.roy@example.com',
    contact: '+919811000005',
    lifetime_value: 600000,
    previous_success_count: 4,
    previous_failure_count: 0,
    historical_success_rate: 1.00,
    opted_out: false,
    created_at: new Date(now.getTime() - 86400000 * 15).toISOString()
  };

  const payE: Payment = {
    id: 'pay_demo_captured_05',
    customer_id: custE.id,
    order_id: 'order_demo_captured_05',
    amount: 149900, // ₹1,499.00
    currency: 'INR',
    status: 'captured', // Already captured!
    failure_category: 'TRANSIENT_BANK_FAILURE',
    failure_code: 'BANK_SYSTEM_BUSY',
    failure_reason: 'Previously failed, subsequently captured by merchant webhook',
    attempt_count: 2,
    recovery_attempts: 1,
    seconds_since_failure: 0,
    last_attempt_at: new Date(now.getTime() - 600 * 1000).toISOString(),
    created_at: new Date(now.getTime() - 3600 * 1000).toISOString(),
    updated_at: new Date(now.getTime() - 600 * 1000).toISOString(),
    ground_truth_recoverable: false,
    ground_truth_best_action: 'STOP',
    ground_truth_expected_outcome: 'RECOVERED',
    ground_truth_reason: 'Payment already captured in Razorpay. Retrying is strictly blocked (ALREADY_SUCCESSFUL).'
  };

  return {
    [payA.id]: { payment: payA, customer: custA },
    [payB.id]: { payment: payB, customer: custB },
    [payC.id]: { payment: payC, customer: custC },
    [payE.id]: { payment: payE, customer: custE }
  };
}
