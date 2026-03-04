# Changelog

## [0.7.0](https://github.com/windmill-labs/webmux/compare/v0.6.2...v0.7.0) (2026-03-04)


### Features

* generate .workmux.yaml with env-aware pane setup in init ([3cc608d](https://github.com/windmill-labs/webmux/commit/3cc608db4c4d19fbfc8e4307d35da0b602643094))
* uncomment services and add npm install in init templates ([2943df2](https://github.com/windmill-labs/webmux/commit/2943df27f3f360cdc339e3ea8753048e51c4c7da))


### Bug Fixes

* comment out services section in wmdev template ([3967301](https://github.com/windmill-labs/webmux/commit/3967301fd4b6c2fe8b8b069b7e1b19991a86fdcb))

## [0.6.2](https://github.com/windmill-labs/webmux/compare/v0.6.1...v0.6.2) (2026-03-04)


### Performance

* reduce GitHub API usage by scoping PR polls to active worktrees ([5634a8e](https://github.com/windmill-labs/webmux/commit/5634a8e268f9aeaaba09f39667723bdc13254735))

## [0.6.1](https://github.com/windmill-labs/webmux/compare/v0.6.0...v0.6.1) (2026-03-04)


### Bug Fixes

* check for systemctl/launchctl before managing services ([61c9819](https://github.com/windmill-labs/webmux/commit/61c9819315202030b21d87f5e273dbdcbd2e39fd))

## [0.6.0](https://github.com/windmill-labs/webmux/compare/v0.5.0...v0.6.0) (2026-03-04)


### Features

* add `wmdev init` onboarding command ([#65](https://github.com/windmill-labs/webmux/issues/65)) ([6e8b128](https://github.com/windmill-labs/webmux/commit/6e8b128785d716bf38cd1a3ea0d45f9837941ec3))
* add `wmdev service` command for running as a system daemon ([#67](https://github.com/windmill-labs/webmux/issues/67)) ([39ba997](https://github.com/windmill-labs/webmux/commit/39ba99704482ea5bfb8567a632b741df3e6bb623))
* extract StartupEnvFields component ([#66](https://github.com/windmill-labs/webmux/issues/66)) ([6a2206d](https://github.com/windmill-labs/webmux/commit/6a2206d53183bcf5f307bb3d919aa6484caef55f))
* rate-limit mitigation for GitHub API calls ([#69](https://github.com/windmill-labs/webmux/issues/69)) ([efb4b4a](https://github.com/windmill-labs/webmux/commit/efb4b4a46154842e6ef5e13320f08710d2f76707))
* render checkbox for boolean startupEnvs, omit unchecked from env ([e274b3b](https://github.com/windmill-labs/webmux/commit/e274b3bc472e60748bd0d389aa08b2230e8918ac))


### Bug Fixes

* escape single quotes in .env.local values for bash sourcing ([#68](https://github.com/windmill-labs/webmux/issues/68)) ([e7022d7](https://github.com/windmill-labs/webmux/commit/e7022d7842ca11e68478679b6412615cd93465df))

## [0.5.0](https://github.com/windmill-labs/workmux-web/compare/v0.4.0...v0.5.0) (2026-03-03)


### Features

* add startup environment variables config ([#59](https://github.com/windmill-labs/workmux-web/issues/59)) ([7ee49f4](https://github.com/windmill-labs/workmux-web/commit/7ee49f46310b5356b35e0e1df68ced88855d74bc))
* show externally-created worktrees in UI ([#62](https://github.com/windmill-labs/workmux-web/issues/62)) ([5b3c8c2](https://github.com/windmill-labs/workmux-web/commit/5b3c8c2ad72bf7d48bd8b7861c3512e2317c9a51))
* support Shift+Enter for newline in terminal via tmux send-keys ([#63](https://github.com/windmill-labs/workmux-web/issues/63)) ([cf87fbe](https://github.com/windmill-labs/workmux-web/commit/cf87fbe50455039bcc6505393e75e5723afd55d0))


### Bug Fixes

* clean up orphaned tmux windows on worktree list poll ([#60](https://github.com/windmill-labs/workmux-web/issues/60)) ([c399d02](https://github.com/windmill-labs/workmux-web/commit/c399d02c5c0881fe8ef3e72171f3077f96fee485))

## [0.4.0](https://github.com/windmill-labs/workmux-web/compare/v0.3.0...v0.4.0) (2026-03-02)


### Features

* add fuzzy search, description preview, and clickable tiles to Linear panel ([#57](https://github.com/windmill-labs/workmux-web/issues/57)) ([b03be8a](https://github.com/windmill-labs/workmux-web/commit/b03be8a48c8c9164fda87095c89b01f67f658122))
* add name field to config for custom dashboard title ([#56](https://github.com/windmill-labs/workmux-web/issues/56)) ([0e7878c](https://github.com/windmill-labs/workmux-web/commit/0e7878c16db41f8d85e9a75386dde168e4758ef5))
* fetch and display GitHub PR inline review comments ([#55](https://github.com/windmill-labs/workmux-web/issues/55)) ([da5a9b2](https://github.com/windmill-labs/workmux-web/commit/da5a9b2db3fcb62ab8eee105d5d091faa0522388))


### Bug Fixes

* defer .env.local sourcing in pane commands to avoid port race condition ([#54](https://github.com/windmill-labs/workmux-web/issues/54)) ([d4e077f](https://github.com/windmill-labs/workmux-web/commit/d4e077f755d404fa825da5092cb6645bd6848ff6))
* single-quote PR_DATA in .env.local for shell safety ([#52](https://github.com/windmill-labs/workmux-web/issues/52)) ([70056d4](https://github.com/windmill-labs/workmux-web/commit/70056d4c24dfe34eab16067ad46c9a3a33ae9565))

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
