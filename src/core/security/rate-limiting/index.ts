/**
 * @file index.ts
 * @description Public endpoint declarations and composition API of the rate-limiting concern.
 */

export { RateLimitExempt } from 'src/core/security/rate-limiting/decorator/rate-limit-exempt.decorator';
export { RateLimit } from 'src/core/security/rate-limiting/decorator/rate-limit.decorator';
export { PostAuthRateLimitGuard } from 'src/core/security/rate-limiting/guard/post-auth-rate-limit.guard';
export { PreAuthRateLimitGuard } from 'src/core/security/rate-limiting/guard/pre-auth-rate-limit.guard';
export { RateLimitingModule } from 'src/core/security/rate-limiting/module';
export { RateLimitPolicy } from 'src/core/security/rate-limiting/rate-limit-policy';
