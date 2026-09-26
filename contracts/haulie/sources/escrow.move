/// Operator-attested physical delivery with on-chain escrow. No World proof,
/// address, contact details, or other delivery personal data belongs on-chain.
module haulie::escrow;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;

const EWrongOperator: u64 = 0;
const EWrongState: u64 = 1;
const EWrongAmount: u64 = 2;
const EInvalidReference: u64 = 3;
const EInvalidAddress: u64 = 4;
const EWrongMerchant: u64 = 5;

const FUNDED: u8 = 0;
const ASSIGNED: u8 = 1;
const PICKED_UP: u8 = 2;
const DELIVERY_CONFIRMED: u8 = 3;
const DISPUTED: u8 = 4;
const PAID: u8 = 5;
const REFUNDED: u8 = 6;

/// The publisher receives the only operator capability. Protect its owner key.
public struct OperatorCap has key, store { id: UID }

/// An immutable, coin-typed configuration created by the operator. The service
/// accepts only its configured object ID and Circle's native USDC coin type.
public struct Config<phantom T> has key, store {
    id: UID,
    operator_cap: ID,
}

public struct Escrow<phantom T> has key {
    id: UID,
    config_id: ID,
    operator_cap: ID,
    job_ref: vector<u8>,
    merchant: address,
    amount: u64,
    funds: Balance<T>,
    payout: address,
    state: u8,
}

/// Kinds: 0 funded, 1 assigned, 2 picked up, 3 delivery confirmed,
/// 4 disputed, 5 paid, 6 refunded, 7 unassigned. Only a random job hash and
/// already-public wallet addresses are exposed, never World identifiers.
public struct EscrowEvent has copy, drop {
    escrow_id: ID,
    job_ref: vector<u8>,
    kind: u8,
    amount: u64,
    recipient: address,
}

fun init(ctx: &mut TxContext) {
    transfer::transfer(OperatorCap { id: object::new(ctx) }, ctx.sender());
}

public fun create_config<T>(cap: &OperatorCap, ctx: &mut TxContext) {
    transfer::public_freeze_object(Config<T> {
        id: object::new(ctx),
        operator_cap: object::id(cap),
    });
}

/// Pass an exact-value coin; compose a coin split in the merchant's PTB.
public fun fund<T>(
    config: &Config<T>,
    job_ref: vector<u8>,
    expected_amount: u64,
    payment: Coin<T>,
    ctx: &mut TxContext,
) {
    assert!(job_ref.length() == 32, EInvalidReference);
    assert!(expected_amount > 0 && coin::value(&payment) == expected_amount, EWrongAmount);
    let escrow = Escrow {
        id: object::new(ctx),
        config_id: object::id(config),
        operator_cap: config.operator_cap,
        job_ref,
        merchant: ctx.sender(),
        amount: expected_amount,
        funds: coin::into_balance(payment),
        payout: @0x0,
        state: FUNDED,
    };
    emit(&escrow, FUNDED, escrow.merchant);
    transfer::share_object(escrow);
}

public fun assign<T>(cap: &OperatorCap, escrow: &mut Escrow<T>, payout: address) {
    authorize(cap, escrow);
    assert!(escrow.state == FUNDED, EWrongState);
    assert!(payout != @0x0, EInvalidAddress);
    escrow.payout = payout;
    escrow.state = ASSIGNED;
    emit(escrow, ASSIGNED, payout);
}

/// Assignment can be released only before custody passes. Reassignment
/// requires a new off-chain World session proof and a new payout snapshot.
public fun unassign<T>(cap: &OperatorCap, escrow: &mut Escrow<T>) {
    authorize(cap, escrow);
    assert!(escrow.state == ASSIGNED, EWrongState);
    escrow.state = FUNDED;
    escrow.payout = @0x0;
    emit(escrow, 7, @0x0);
}

public fun confirm_pickup<T>(cap: &OperatorCap, escrow: &mut Escrow<T>) {
    authorize(cap, escrow);
    assert!(escrow.state == ASSIGNED, EWrongState);
    escrow.state = PICKED_UP;
    emit(escrow, PICKED_UP, escrow.payout);
}

public fun confirm_delivery<T>(cap: &OperatorCap, escrow: &mut Escrow<T>) {
    authorize(cap, escrow);
    assert!(escrow.state == PICKED_UP, EWrongState);
    escrow.state = DELIVERY_CONFIRMED;
    emit(escrow, DELIVERY_CONFIRMED, escrow.payout);
}

public fun dispute<T>(cap: &OperatorCap, escrow: &mut Escrow<T>) {
    authorize(cap, escrow);
    lock_dispute(escrow);
}

/// A merchant can freeze escrow directly, without relying on the operator.
public fun merchant_dispute<T>(escrow: &mut Escrow<T>, ctx: &TxContext) {
    assert!(ctx.sender() == escrow.merchant, EWrongMerchant);
    lock_dispute(escrow);
}

public fun release<T>(cap: &OperatorCap, escrow: &mut Escrow<T>, ctx: &mut TxContext) {
    authorize(cap, escrow);
    assert!(escrow.state == DELIVERY_CONFIRMED, EWrongState);
    pay(escrow, ctx);
}

public fun refund<T>(cap: &OperatorCap, escrow: &mut Escrow<T>, ctx: &mut TxContext) {
    authorize(cap, escrow);
    assert!(escrow.state == FUNDED, EWrongState);
    repay(escrow, ctx);
}

public fun merchant_refund<T>(escrow: &mut Escrow<T>, ctx: &mut TxContext) {
    assert!(ctx.sender() == escrow.merchant, EWrongMerchant);
    assert!(escrow.state == FUNDED, EWrongState);
    repay(escrow, ctx);
}

/// Resolution is explicit and terminal; it never silently swaps a wallet.
public fun resolve_dispute<T>(
    cap: &OperatorCap,
    escrow: &mut Escrow<T>,
    pay_courier: bool,
    ctx: &mut TxContext,
) {
    authorize(cap, escrow);
    assert!(escrow.state == DISPUTED, EWrongState);
    if (pay_courier) pay(escrow, ctx) else repay(escrow, ctx);
}

fun authorize<T>(cap: &OperatorCap, escrow: &Escrow<T>) {
    assert!(object::id(cap) == escrow.operator_cap, EWrongOperator);
}

fun lock_dispute<T>(escrow: &mut Escrow<T>) {
    assert!(
        escrow.state == ASSIGNED || escrow.state == PICKED_UP || escrow.state == DELIVERY_CONFIRMED,
        EWrongState,
    );
    escrow.state = DISPUTED;
    emit(escrow, DISPUTED, escrow.payout);
}

fun pay<T>(escrow: &mut Escrow<T>, ctx: &mut TxContext) {
    assert!(escrow.payout != @0x0, EInvalidAddress);
    assert!(balance::value(&escrow.funds) == escrow.amount, EWrongAmount);
    escrow.state = PAID;
    let payment = coin::from_balance(balance::withdraw_all(&mut escrow.funds), ctx);
    transfer::public_transfer(payment, escrow.payout);
    emit(escrow, PAID, escrow.payout);
}

fun repay<T>(escrow: &mut Escrow<T>, ctx: &mut TxContext) {
    assert!(balance::value(&escrow.funds) == escrow.amount, EWrongAmount);
    escrow.state = REFUNDED;
    let payment = coin::from_balance(balance::withdraw_all(&mut escrow.funds), ctx);
    transfer::public_transfer(payment, escrow.merchant);
    emit(escrow, REFUNDED, escrow.merchant);
}

fun emit<T>(escrow: &Escrow<T>, kind: u8, recipient: address) {
    event::emit(EscrowEvent {
        escrow_id: object::id(escrow),
        job_ref: escrow.job_ref,
        kind,
        amount: escrow.amount,
        recipient,
    });
}

public fun state<T>(escrow: &Escrow<T>): u8 { escrow.state }
public fun payout<T>(escrow: &Escrow<T>): address { escrow.payout }
public fun amount<T>(escrow: &Escrow<T>): u64 { escrow.amount }
public fun remaining<T>(escrow: &Escrow<T>): u64 { balance::value(&escrow.funds) }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
