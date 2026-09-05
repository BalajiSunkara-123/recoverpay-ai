/**
 * RecoverPay Data Store & Persistence Layer
 * Provides an in-memory cache backed by JSON persistence.
 * Seeds 600 deterministic records with ground truth on initial initialization.
 */

import fs from 'fs';
import path from 'path';
import {
  Customer,
  Payment,
  PolicyRules,
  AuditEvent,
  DatasetStats
} from '../../src/types/index.ts';
import { generateSyntheticDataset } from '../data/generator.ts';
import { createDemoScenarios, DemoScenarioPair } from '../data/demoScenarios.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

export interface DatabaseState {
  version: number;
  customers: Customer[];
  payments: Payment[];
  policy: PolicyRules;
  audit_events: AuditEvent[];
  stats: DatasetStats;
}

const DEFAULT_POLICY: PolicyRules = {
  id: 'pol_default_01',
  max_retries: 2,
  max_automated_recovery_amount: 5000000, // ₹50,000 in paise
  min_retry_cooldown_seconds: 900,        // 15 minutes
  do_not_retry_after_success: true,
  do_not_retry_if_customer_opted_out: true,
  low_confidence_threshold: 0.60
};

class DataStore {
  private state: DatabaseState;
  private initialized = false;
  private demoScenarios: Record<string, DemoScenarioPair> = createDemoScenarios();

  constructor() {
    this.state = this.initialize();
  }

  private initialize(): DatabaseState {
    if (this.initialized) return this.state;

    // Check if persistence file already exists
    if (fs.existsSync(STORE_FILE)) {
      try {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as DatabaseState;
        if (parsed.payments && parsed.payments.length === 600) {
          this.initialized = true;
          return parsed;
        }
      } catch (err) {
        console.warn('[DataStore] Corrupt store file encountered, re-seeding dataset...', err);
      }
    }

    // Generate deterministic 600-record dataset
    const generated = generateSyntheticDataset(1337);
    const freshState: DatabaseState = {
      version: 1,
      customers: generated.customers,
      payments: generated.payments,
      policy: DEFAULT_POLICY,
      audit_events: [],
      stats: generated.stats
    };

    this.saveToDisk(freshState);
    this.initialized = true;
    return freshState;
  }

  private saveToDisk(state: DatabaseState): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DataStore] Failed to write store to disk:', err);
    }
  }

  public reset(seed = 1337): DatabaseState {
    const generated = generateSyntheticDataset(seed);
    this.demoScenarios = createDemoScenarios();
    this.state = {
      version: 1,
      customers: generated.customers,
      payments: generated.payments,
      policy: DEFAULT_POLICY,
      audit_events: [],
      stats: generated.stats
    };
    this.saveToDisk(this.state);
    return this.state;
  }

  public resetDemoScenario(id?: string): void {
    const fresh = createDemoScenarios();
    if (id && fresh[id]) {
      this.demoScenarios[id] = fresh[id];
    } else {
      this.demoScenarios = fresh;
    }
  }

  public getDemoScenario(id: string): DemoScenarioPair | undefined {
    return this.demoScenarios[id];
  }

  public getAllDemoScenarios(): Record<string, DemoScenarioPair> {
    return this.demoScenarios;
  }

  // Payments Accessors
  public getAllPayments(): Payment[] {
    return this.state.payments;
  }

  public getPaymentById(id: string): Payment | undefined {
    if (this.demoScenarios[id]) {
      return this.demoScenarios[id].payment;
    }
    return this.state.payments.find(p => p.id === id);
  }

  public updatePayment(id: string, updates: Partial<Payment>): Payment | undefined {
    if (this.demoScenarios[id]) {
      const existing = this.demoScenarios[id].payment;
      const updated: Payment = {
        ...existing,
        ...updates,
        updated_at: new Date().toISOString()
      };
      this.demoScenarios[id].payment = updated;
      return updated;
    }

    const idx = this.state.payments.findIndex(p => p.id === id);
    if (idx === -1) return undefined;

    const existing = this.state.payments[idx];
    const updated: Payment = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString()
    };
    this.state.payments[idx] = updated;
    this.saveToDisk(this.state);
    return updated;
  }

  // Customers Accessors
  public getAllCustomers(): Customer[] {
    return this.state.customers;
  }

  public getCustomerById(id: string): Customer | undefined {
    for (const key of Object.keys(this.demoScenarios)) {
      if (this.demoScenarios[key].customer.id === id) {
        return this.demoScenarios[key].customer;
      }
    }
    return this.state.customers.find(c => c.id === id);
  }

  // Policy Accessors
  public getPolicy(): PolicyRules {
    return this.state.policy;
  }

  public updatePolicy(updates: Partial<PolicyRules>): PolicyRules {
    this.state.policy = {
      ...this.state.policy,
      ...updates
    };
    this.saveToDisk(this.state);
    return this.state.policy;
  }

  // Audit Events (Append-Only)
  public getAuditEvents(paymentId?: string): AuditEvent[] {
    if (paymentId) {
      return this.state.audit_events.filter(e => e.payment_id === paymentId);
    }
    return this.state.audit_events;
  }

  public appendAuditEvent(event: AuditEvent): void {
    // Append-only guarantee: push to end, never overwrite or delete
    this.state.audit_events.push(event);
    this.saveToDisk(this.state);
  }

  public getStats(): DatasetStats {
    return this.state.stats;
  }
}

export const dataStore = new DataStore();
