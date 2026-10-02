-- Cloudflare D1 SQL Database Migration: Initial Schema for WacPad
-- Migration ID: 0001_initial_schema.sql

-- Customer license registry (maps customer email & Stripe IDs to WP1- license keys)
CREATE TABLE IF NOT EXISTS licenses (
  email TEXT PRIMARY KEY,
  license_key TEXT NOT NULL,
  customer_id TEXT,
  session_id TEXT,
  tier TEXT DEFAULT 'ProLifetime',
  created_at INTEGER NOT NULL
);

-- Active device hardware registry (enforces max 3 seats per license)
CREATE TABLE IF NOT EXISTS devices (
  license_hash TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  device_name TEXT DEFAULT 'Desktop Workstation',
  os TEXT DEFAULT 'Unknown OS',
  activated_at INTEGER NOT NULL,
  PRIMARY KEY (license_hash, machine_id)
);

-- Query performance indexes
CREATE INDEX IF NOT EXISTS idx_devices_license_hash ON devices (license_hash);
CREATE INDEX IF NOT EXISTS idx_licenses_customer_id ON licenses (customer_id);
