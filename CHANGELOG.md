# Changelog

## [0.3.0](https://github.com/windmill-labs/workmux-web/compare/v0.2.3...v0.3.0) (2026-03-02)


### Features

* add agent + lightning bolt SVG favicon ([0e5a099](https://github.com/windmill-labs/workmux-web/commit/0e5a09958d88b058bc7526333c774231815b85b6))
* read-only Linear integration ([#51](https://github.com/windmill-labs/workmux-web/issues/51)) ([6f11416](https://github.com/windmill-labs/workmux-web/commit/6f114168f8360c67e5d4dac4b540bb89cc94d872))
* real-time notification system for agent events ([#47](https://github.com/windmill-labs/workmux-web/issues/47)) ([c2fa730](https://github.com/windmill-labs/workmux-web/commit/c2fa730e76b4973afdc6eae3389f4a64379714f0))
* uncommitted changes indicator on TopBar ([#50](https://github.com/windmill-labs/workmux-web/issues/50)) ([413ec45](https://github.com/windmill-labs/workmux-web/commit/413ec45aff99bf11f299063f634b74acbd7eaf09))


### Bug Fixes

* graceful recovery when tmux dies during polling ([4073132](https://github.com/windmill-labs/workmux-web/commit/4073132d968167c95de69047f887859b525695ed))
* persist notification dot until worktree is focused ([#49](https://github.com/windmill-labs/workmux-web/issues/49)) ([f2ca3de](https://github.com/windmill-labs/workmux-web/commit/f2ca3de61cd07b74b6600c98898fa8073b5fd947))
* reduce notification toast auto-dismiss to 4 seconds ([10c0230](https://github.com/windmill-labs/workmux-web/commit/10c023079c9ecd29ba03cde6e43b1be5029780f5))
* resolve detached HEAD breaking worktree tmux lookup during rebase ([e6354b0](https://github.com/windmill-labs/workmux-web/commit/e6354b0a926d9c1eb8abd6263cdbc54a0dd0b6df))
* reuse removingBranches state for merge loading indicator ([56beed5](https://github.com/windmill-labs/workmux-web/commit/56beed57656655fb1cf8dfcb6ab2b2201a560b6e))


### Performance

* optimize backend polling, caching, and WebSocket throughput ([#43](https://github.com/windmill-labs/workmux-web/issues/43)) ([35bf00a](https://github.com/windmill-labs/workmux-web/commit/35bf00a850a036194cc91e48c6418f34a6ee31e5))

## [0.2.3](https://github.com/windmill-labs/workmux-web/compare/v0.2.2...v0.2.3) (2026-03-01)


### Bug Fixes

* mount ~/.codex by default instead of via extraMounts config ([ee081f3](https://github.com/windmill-labs/workmux-web/commit/ee081f3fcb7fdd7962a722679a38e613f75cfb01))

## [0.2.2](https://github.com/windmill-labs/workmux-web/compare/v0.2.1...v0.2.2) (2026-03-01)


### Bug Fixes

* bundle backend at publish time to resolve missing dependencies ([#40](https://github.com/windmill-labs/workmux-web/issues/40)) ([98eff32](https://github.com/windmill-labs/workmux-web/commit/98eff32320e0ed8b96676bd3542f5d66a6153f59))

## [0.2.1](https://github.com/windmill-labs/workmux-web/compare/v0.2.0...v0.2.1) (2026-03-01)


### Bug Fixes

* add setup-node step for npm publish auth ([ff41cb4](https://github.com/windmill-labs/workmux-web/commit/ff41cb45136dac06d8c1c4455ea6e50356303af2))

## [0.2.0](https://github.com/windmill-labs/workmux-web/compare/v0.1.0...v0.2.0) (2026-03-01)


### Features

* add debug log levels with --debug flag for wmdev ([331ed1a](https://github.com/windmill-labs/workmux-web/commit/331ed1a0445869c2d187a872f61a532c52315227))
* move port allocation into wmdev backend ([#34](https://github.com/windmill-labs/workmux-web/issues/34)) ([ade42fd](https://github.com/windmill-labs/workmux-web/commit/ade42fddecb27b350c548cc2c3146014ccf4b340))


### Bug Fixes

* add passwd entry for UID 1000 to fix "I have no name!" prompt ([#36](https://github.com/windmill-labs/workmux-web/issues/36)) ([9f8b871](https://github.com/windmill-labs/workmux-web/commit/9f8b871491574ca8f465027c88292132df4cbf46))
* correct repo URL to windmill-labs/workmux-web ([de35efe](https://github.com/windmill-labs/workmux-web/commit/de35efec763748bfa9dbb1b74c9ebb95ece278d0))
* replace autofocus attribute with use:action to resolve a11y warning ([cdf905d](https://github.com/windmill-labs/workmux-web/commit/cdf905d4730a9e8e7ea90265653d9329a6687175))
* terminal clipboard copy failing in non-secure contexts ([2a3a565](https://github.com/windmill-labs/workmux-web/commit/2a3a5655be81ad48da61f07140627ea4da2fbe7a))
