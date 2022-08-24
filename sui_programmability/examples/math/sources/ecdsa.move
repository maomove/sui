// Copyright (c) 2022, Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/// Basic ECDSA util contract, emits an event with data with the output of the crypto function
module math::ecdsa {
    use sui::crypto;
    use sui::event;

    /// Event on whether the signature is verified
    struct VerifiedEvent has copy, drop {
        is_verified: bool,
    }
    
    /// Event on recovered pubkey
    struct EcRecoverEvent has copy, drop {
        pubkey: vector<u8>
    }

    /// Event on hashed data
    struct HashedData has copy, drop {
        data: vector<u8>
    }

    public entry fun keccak256(data: vector<u8>) {
        event::emit(HashedData { data: crypto::keccak256(data)});
    }

    public entry fun ecrecover(signature: vector<u8>, hashed_msg: vector<u8>) {
        event::emit(EcRecoverEvent {pubkey: crypto::ecrecover(signature, hashed_msg)});
    }

    public entry fun secp256k1_verify(signature: vector<u8>, public_key: vector<u8>, hashed_msg: vector<u8>) {
        event::emit(VerifiedEvent {is_verified: crypto::secp256k1_verify(signature, public_key, hashed_msg)});
    }
}
