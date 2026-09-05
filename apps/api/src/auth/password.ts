import { hash, verify } from 'argon2'

// argon2id password hashing. `hash` defaults to argon2id and returns an async
// Promise; `verify` compares a plaintext against an encoded hash. Both mirror
// the argon2 package API directly so callers `await` them.
export const hashPassword = (pw: string) => hash(pw)
export const verifyPassword = (pw: string, hashValue: string) => verify(hashValue, pw)
