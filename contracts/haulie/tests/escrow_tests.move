#[test_only]
module haulie::escrow_tests;

use haulie::escrow::{Self, Config, Escrow, OperatorCap};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as scenario, Scenario};

const OPERATOR: address = @0xa;
const MERCHANT: address = @0xb;
const COURIER: address = @0xc;
const FEE: u64 = 6000000;

fun setup(): Scenario {
    let mut s = scenario::begin(OPERATOR);
    escrow::init_for_testing(s.ctx());
    s.next_tx(OPERATOR);
    let cap = s.take_from_sender<OperatorCap>();
    escrow::create_config<SUI>(&cap, s.ctx());
    s.return_to_sender(cap);
    s.next_tx(MERCHANT);
    let config = s.take_immutable<Config<SUI>>();
    let coin = coin::mint_for_testing<SUI>(FEE, s.ctx());
    escrow::fund(&config, b"0123456789abcdef0123456789abcdef", FEE, coin, s.ctx());
    scenario::return_immutable(config);
    s.next_tx(OPERATOR);
    s
}

#[test]
fun successful_delivery_pays_snapshot() {
    let mut s = setup();
    let cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    assert!(escrow::remaining(&job) == FEE);
    escrow::assign(&cap, &mut job, COURIER);
    escrow::confirm_pickup(&cap, &mut job);
    escrow::confirm_delivery(&cap, &mut job);
    escrow::release(&cap, &mut job, s.ctx());
    assert!(escrow::state(&job) == 5);
    assert!(escrow::remaining(&job) == 0);
    assert!(escrow::payout(&job) == COURIER);
    scenario::return_shared(job);
    s.return_to_sender(cap);
    s.next_tx(COURIER);
    let payment = s.take_from_sender<Coin<SUI>>();
    assert!(coin::value(&payment) == FEE);
    coin::burn_for_testing(payment);
    s.end();
}

#[test]
#[expected_failure(abort_code = 1, location = haulie::escrow)]
fun cannot_release_twice() {
    let mut s = setup();
    let cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::assign(&cap, &mut job, COURIER);
    escrow::confirm_pickup(&cap, &mut job);
    escrow::confirm_delivery(&cap, &mut job);
    escrow::release(&cap, &mut job, s.ctx());
    escrow::release(&cap, &mut job, s.ctx());
    scenario::return_shared(job);
    s.return_to_sender(cap);
    s.end();
}

#[test]
#[expected_failure(abort_code = 1, location = haulie::escrow)]
fun cannot_pay_before_handoffs() {
    let mut s = setup();
    let cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::assign(&cap, &mut job, COURIER);
    escrow::release(&cap, &mut job, s.ctx());
    scenario::return_shared(job);
    s.return_to_sender(cap);
    s.end();
}

#[test]
#[expected_failure(abort_code = 1, location = haulie::escrow)]
fun dispute_blocks_release() {
    let mut s = setup();
    let cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::assign(&cap, &mut job, COURIER);
    escrow::confirm_pickup(&cap, &mut job);
    escrow::confirm_delivery(&cap, &mut job);
    escrow::dispute(&cap, &mut job);
    escrow::release(&cap, &mut job, s.ctx());
    scenario::return_shared(job);
    s.return_to_sender(cap);
    s.end();
}

#[test]
fun unassign_allows_new_snapshot() {
    let s = setup();
    let cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::assign(&cap, &mut job, COURIER);
    escrow::unassign(&cap, &mut job);
    assert!(escrow::state(&job) == 0);
    assert!(escrow::payout(&job) == @0x0);
    escrow::assign(&cap, &mut job, @0xd);
    assert!(escrow::payout(&job) == @0xd);
    scenario::return_shared(job);
    s.return_to_sender(cap);
    s.end();
}

#[test]
#[expected_failure(abort_code = 1, location = haulie::escrow)]
fun cannot_unassign_after_pickup() {
    let s = setup();
    let cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::assign(&cap, &mut job, COURIER);
    escrow::confirm_pickup(&cap, &mut job);
    escrow::unassign(&cap, &mut job);
    scenario::return_shared(job);
    s.return_to_sender(cap);
    s.end();
}

#[test]
fun merchant_receives_refund() {
    let mut s = setup();
    let cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::refund(&cap, &mut job, s.ctx());
    assert!(escrow::state(&job) == 6);
    assert!(escrow::remaining(&job) == 0);
    scenario::return_shared(job);
    s.return_to_sender(cap);
    s.next_tx(MERCHANT);
    let payment = s.take_from_sender<Coin<SUI>>();
    assert!(coin::value(&payment) == FEE);
    coin::burn_for_testing(payment);
    s.end();
}

#[test]
#[expected_failure(abort_code = 1, location = haulie::escrow)]
fun cannot_refund_twice() {
    let mut s = setup();
    let cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::refund(&cap, &mut job, s.ctx());
    escrow::refund(&cap, &mut job, s.ctx());
    scenario::return_shared(job);
    s.return_to_sender(cap);
    s.end();
}

#[test]
fun disputed_job_refunds_only_by_resolution() {
    let mut s = setup();
    let cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::assign(&cap, &mut job, COURIER);
    escrow::confirm_pickup(&cap, &mut job);
    escrow::dispute(&cap, &mut job);
    escrow::resolve_dispute(&cap, &mut job, false, s.ctx());
    assert!(escrow::state(&job) == 6);
    assert!(escrow::remaining(&job) == 0);
    scenario::return_shared(job);
    s.return_to_sender(cap);
    s.end();
}

#[test]
#[expected_failure(abort_code = 0, location = haulie::escrow)]
fun unrelated_capability_cannot_assign() {
    let mut s = setup();
    s.next_tx(@0xd);
    escrow::init_for_testing(s.ctx());
    s.next_tx(@0xd);
    let other_cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::assign(&other_cap, &mut job, @0xd);
    scenario::return_shared(job);
    s.return_to_sender(other_cap);
    s.end();
}

#[test]
#[expected_failure(abort_code = 2, location = haulie::escrow)]
fun incorrect_funding_amount_rejected() {
    let mut s = setup();
    s.next_tx(MERCHANT);
    let config = s.take_immutable<Config<SUI>>();
    let coin = coin::mint_for_testing<SUI>(FEE - 1, s.ctx());
    escrow::fund(&config, b"fedcba9876543210fedcba9876543210", FEE, coin, s.ctx());
    scenario::return_immutable(config);
    s.end();
}

#[test]
#[expected_failure(abort_code = 1, location = haulie::escrow)]
fun cannot_replace_payout_snapshot() {
    let s = setup();
    let cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::assign(&cap, &mut job, COURIER);
    escrow::assign(&cap, &mut job, @0xd);
    scenario::return_shared(job);
    s.return_to_sender(cap);
    s.end();
}

#[test]
#[expected_failure(abort_code = 5, location = haulie::escrow)]
fun unrelated_wallet_cannot_refund() {
    let mut s = setup();
    s.next_tx(@0xd);
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::merchant_refund(&mut job, s.ctx());
    scenario::return_shared(job);
    s.end();
}

#[test]
fun operator_can_resolve_dispute_to_snapshot() {
    let mut s = setup();
    let cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::assign(&cap, &mut job, COURIER);
    escrow::confirm_pickup(&cap, &mut job);
    escrow::dispute(&cap, &mut job);
    escrow::resolve_dispute(&cap, &mut job, true, s.ctx());
    assert!(escrow::state(&job) == 5);
    assert!(escrow::remaining(&job) == 0);
    scenario::return_shared(job);
    s.return_to_sender(cap);
    s.next_tx(COURIER);
    let payment = s.take_from_sender<Coin<SUI>>();
    assert!(coin::value(&payment) == FEE);
    coin::burn_for_testing(payment);
    s.end();
}

#[test]
#[expected_failure(abort_code = 1, location = haulie::escrow)]
fun cannot_refund_a_paid_job() {
    let mut s = setup();
    let cap = s.take_from_sender<OperatorCap>();
    let mut job = s.take_shared<Escrow<SUI>>();
    escrow::assign(&cap, &mut job, COURIER);
    escrow::confirm_pickup(&cap, &mut job);
    escrow::confirm_delivery(&cap, &mut job);
    escrow::release(&cap, &mut job, s.ctx());
    escrow::refund(&cap, &mut job, s.ctx());
    scenario::return_shared(job);
    s.return_to_sender(cap);
    s.end();
}
