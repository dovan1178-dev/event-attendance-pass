#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol};

#[contract]
pub struct EventAttendanceContract;

#[contractimpl]
impl EventAttendanceContract {
    pub fn register(env: Env, user: Address, event_id: Symbol) -> bool {
        let key = (symbol_short!("REG"), event_id.clone(), user.clone());

        if env.storage().persistent().has(&key) {
            panic!("Already registered");
        }

        env.storage().persistent().set(&key, &true);

        env.events().publish(
            (symbol_short!("register"), event_id, user),
            true,
        );

        true
    }

    pub fn check_in(env: Env, user: Address, event_id: Symbol) -> bool {
        let reg_key = (symbol_short!("REG"), event_id.clone(), user.clone());
        let check_key = (symbol_short!("CHECK"), event_id.clone(), user.clone());

        if !env.storage().persistent().has(&reg_key) {
            panic!("User not registered");
        }

        if env.storage().persistent().has(&check_key) {
            panic!("Already checked in");
        }

        env.storage().persistent().set(&check_key, &true);

        env.events().publish(
            (symbol_short!("checkin"), event_id, user),
            true,
        );

        true
    }

    pub fn is_registered(env: Env, user: Address, event_id: Symbol) -> bool {
        let key = (symbol_short!("REG"), event_id, user);
        env.storage().persistent().get(&key).unwrap_or(false)
    }

    pub fn has_checked_in(env: Env, user: Address, event_id: Symbol) -> bool {
        let key = (symbol_short!("CHECK"), event_id, user);
        env.storage().persistent().get(&key).unwrap_or(false)
    }
}
