BEGIN;

CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('merchant', 'courier', 'operator')),
  display_name text NOT NULL,
  access_token_hash text NOT NULL CHECK (length(access_token_hash) = 64),
  wallet_address text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  session_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE couriers (
  id uuid PRIMARY KEY REFERENCES accounts(id),
  account_status text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'revoked')),
  world_session_id text UNIQUE,
  unique_human_verified_at timestamptz,
  wallet_address text,
  wallet_bound_at timestamptz,
  service_area text,
  vehicle_type text,
  contact_method text,
  rules_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES accounts(id),
  parcel_category text NOT NULL,
  pickup_area text NOT NULL,
  destination_area text NOT NULL,
  pickup_address text NOT NULL,
  destination_address text NOT NULL,
  fee_usdc bigint NOT NULL CHECK (fee_usdc > 0 AND fee_usdc <= 10000000000),
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','FUNDED','ASSIGNED','PICKED_UP','DELIVERY_CONFIRMED','PAYOUT_RETRY','PAID','DISPUTED','RESOLVED','REFUNDED')),
  assigned_courier_id uuid REFERENCES couriers(id),
  payout_address text,
  escrow_object_id text UNIQUE,
  funding_digest text UNIQUE,
  delivery_deadline timestamptz NOT NULL,
  cancellation_rules text NOT NULL,
  assignment_generation integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((assigned_courier_id IS NULL) = (payout_address IS NULL)),
  CHECK (state NOT IN ('ASSIGNED','PICKED_UP','DELIVERY_CONFIRMED','PAYOUT_RETRY','PAID') OR assigned_courier_id IS NOT NULL),
  CHECK (state = 'DRAFT' OR escrow_object_id IS NOT NULL)
);
CREATE INDEX jobs_feed ON jobs(state, delivery_deadline);
CREATE INDEX jobs_merchant ON jobs(merchant_id, created_at DESC);
CREATE INDEX jobs_courier ON jobs(assigned_courier_id, created_at DESC);

CREATE TABLE verification_requests (
  id uuid PRIMARY KEY,
  job_id uuid REFERENCES jobs(id),
  courier_id uuid NOT NULL REFERENCES couriers(id),
  stage text NOT NULL CHECK (stage IN ('ENROLL_UNIQUENESS','ENROLL_SESSION','ACCEPT_JOB','CONFIRM_PICKUP')),
  nonce text NOT NULL UNIQUE,
  rp_context jsonb NOT NULL,
  expected_session_id text,
  environment text NOT NULL CHECK (environment IN ('staging', 'production')),
  action text,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','consumed','cancelled')),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((stage IN ('ACCEPT_JOB','CONFIRM_PICKUP')) = (job_id IS NOT NULL))
);
CREATE INDEX verification_requests_courier ON verification_requests(courier_id, created_at DESC);

CREATE TABLE used_world_proofs (
  proof_identifier text PRIMARY KEY,
  courier_id uuid NOT NULL REFERENCES couriers(id),
  proof_type text NOT NULL CHECK (proof_type IN ('session','uniqueness')),
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE delivery_verifications (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id),
  courier_id uuid NOT NULL REFERENCES couriers(id),
  assignment_generation integer NOT NULL,
  stage text NOT NULL CHECK (stage IN ('ACCEPT_JOB','CONFIRM_PICKUP')),
  verification_request_id uuid NOT NULL UNIQUE REFERENCES verification_requests(id),
  session_nullifier text NOT NULL UNIQUE REFERENCES used_world_proofs(proof_identifier),
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, assignment_generation, stage)
);

CREATE TABLE wallet_challenges (
  id uuid PRIMARY KEY,
  courier_id uuid NOT NULL REFERENCES couriers(id),
  wallet_address text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE handoff_challenges (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id),
  stage text NOT NULL CHECK (stage = 'RECIPIENT'),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_recipient_challenge ON handoff_challenges(job_id, stage) WHERE consumed_at IS NULL;

CREATE TABLE job_events (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id),
  actor_id uuid REFERENCES accounts(id),
  actor_role text NOT NULL,
  event_type text NOT NULL,
  sui_digest text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_events_timeline ON job_events(job_id, id);
CREATE FUNCTION prevent_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'The delivery audit log is append-only'; END;
$$;
CREATE TRIGGER append_only_job_events BEFORE UPDATE OR DELETE ON job_events FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();

CREATE TABLE settlements (
  job_id uuid PRIMARY KEY REFERENCES jobs(id),
  payout_amount bigint NOT NULL CHECK (payout_amount > 0),
  wallet_address text NOT NULL,
  digest text UNIQUE,
  status text NOT NULL CHECK (status IN ('processing','retry','paid','frozen')),
  retry_count integer NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'paid' OR digest IS NOT NULL)
);
CREATE TABLE disputes (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id),
  reason text NOT NULL,
  evidence_references jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text,
  resolver uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX one_open_dispute ON disputes(job_id) WHERE status = 'open';
CREATE TABLE request_limits (
  subject text NOT NULL,
  scope text NOT NULL,
  bucket timestamptz NOT NULL,
  attempts integer NOT NULL,
  PRIMARY KEY(subject, scope, bucket)
);
COMMIT;
