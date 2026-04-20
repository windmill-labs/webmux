# Changelog

## [0.28.0](https://github.com/windmill-labs/webmux/compare/v0.27.1...v0.28.0) (2026-04-20)


### Features

* add non-terminal chat ui for codex and claude ([#216](https://github.com/windmill-labs/webmux/issues/216)) ([bd1b91a](https://github.com/windmill-labs/webmux/commit/bd1b91a2af6a39c8a0fd75aff746bf110f8d0d74))
* share api contract across backend and frontend ([#213](https://github.com/windmill-labs/webmux/issues/213)) ([47b26be](https://github.com/windmill-labs/webmux/commit/47b26be5aec24716144278c836ffb3020d33a4af))


### Bug Fixes

* keep dashboard pr sync active ([#219](https://github.com/windmill-labs/webmux/issues/219)) ([79371cb](https://github.com/windmill-labs/webmux/commit/79371cb5fa337c53d0e91bbbef075b0cf2c87867))


### Performance

* lazy-load diff dialog ([#217](https://github.com/windmill-labs/webmux/issues/217)) ([93b5cce](https://github.com/windmill-labs/webmux/commit/93b5cce472550ed530bdbdcdf54910d42a3f4f2a))
* trim dashboard polling and test overhead ([#202](https://github.com/windmill-labs/webmux/issues/202)) ([32baa8b](https://github.com/windmill-labs/webmux/commit/32baa8baa864cab3228dd6d090985471defbd344))

## [0.27.1](https://github.com/windmill-labs/webmux/compare/v0.27.0...v0.27.1) (2026-04-09)


### Bug Fixes

* stabilize docker sandbox shell startup ([#209](https://github.com/windmill-labs/webmux/issues/209)) ([da32507](https://github.com/windmill-labs/webmux/commit/da32507c4c3643d1213b97a0a72669aec56997ff))
* use host callback url for sandbox hooks ([#211](https://github.com/windmill-labs/webmux/issues/211)) ([e4cc15e](https://github.com/windmill-labs/webmux/commit/e4cc15e02f42d8d5c49118d78b56b577b621d112))

## [0.27.0](https://github.com/windmill-labs/webmux/compare/v0.26.0...v0.27.0) (2026-04-09)


### Features

* add worktree search and archive controls ([#206](https://github.com/windmill-labs/webmux/issues/206)) ([c68b8da](https://github.com/windmill-labs/webmux/commit/c68b8daf156538682339f0c51d9e419b19457103))
* reuse toast component for ui feedback ([#207](https://github.com/windmill-labs/webmux/issues/207)) ([0c15532](https://github.com/windmill-labs/webmux/commit/0c15532e82d5322441fd5a8fa25675b3a1bf7392))


### Bug Fixes

* add auto-name timeout fallback ([#205](https://github.com/windmill-labs/webmux/issues/205)) ([066375a](https://github.com/windmill-labs/webmux/commit/066375a274af5482b423637fa6f40009a8e8417b))

## [0.26.0](https://github.com/windmill-labs/webmux/compare/v0.25.0...v0.26.0) (2026-04-03)


### Features

* support `--agent=both` in the CLI ([#200](https://github.com/windmill-labs/webmux/issues/200)) ([1a8b32b](https://github.com/windmill-labs/webmux/commit/1a8b32b34cd5454b9439b1a6c2b70062cb4812a6))


### Bug Fixes

* remove svelte build warnings ([#198](https://github.com/windmill-labs/webmux/issues/198)) ([8c679bb](https://github.com/windmill-labs/webmux/commit/8c679bbba7ca0f6499d0c3c82a8c24a645c19115))

## [0.25.0](https://github.com/windmill-labs/webmux/compare/v0.24.1...v0.25.0) (2026-03-31)


### Features

* add --existing flag to `wm add` for resuming work on remote branches ([0cae50c](https://github.com/windmill-labs/webmux/commit/0cae50c86286b8859143e15e90000a4c98c27a54))

## [0.24.1](https://github.com/windmill-labs/webmux/compare/v0.24.0...v0.24.1) (2026-03-31)


### Bug Fixes

* remove --max-tokens use ([e42e175](https://github.com/windmill-labs/webmux/commit/e42e175fa97492b1e47f6a7144ebffb79c2710de))

## [0.24.0](https://github.com/windmill-labs/webmux/compare/v0.23.0...v0.24.0) (2026-03-31)


### Features

* add paired claude and codex worktrees ([#193](https://github.com/windmill-labs/webmux/issues/193)) ([004404f](https://github.com/windmill-labs/webmux/commit/004404f5769633e09ce64529ce165eeee4e74dd1))
* improve auto-name error reporting and speed ([3c8c984](https://github.com/windmill-labs/webmux/commit/3c8c984717f4f6826bb9f1fed92b5f08cd043333))
* improve auto-name error reporting and speed ([3c8c984](https://github.com/windmill-labs/webmux/commit/3c8c984717f4f6826bb9f1fed92b5f08cd043333))
* improve auto-name error reporting and speed ([b6b51d2](https://github.com/windmill-labs/webmux/commit/b6b51d2cad6a08c17e5b856e5f654f28d2cec7af))
* show git status in diff dialog ([#192](https://github.com/windmill-labs/webmux/issues/192)) ([4d587f5](https://github.com/windmill-labs/webmux/commit/4d587f56d0ea3e01a386fd06467f5c5c8c90e9b7))


### Bug Fixes

* soften review comment prompt ([#194](https://github.com/windmill-labs/webmux/issues/194)) ([53b952e](https://github.com/windmill-labs/webmux/commit/53b952e7157fe9f2d860ac99bf80324e19215250))

## [0.23.0](https://github.com/windmill-labs/webmux/compare/v0.22.1...v0.23.0) (2026-03-27)


### Features

* show creation status logs in CLI add command ([#186](https://github.com/windmill-labs/webmux/issues/186)) ([2d8a82f](https://github.com/windmill-labs/webmux/commit/2d8a82f5e7a75f13b0985b8802927e73bd8eb1e7))


### Bug Fixes

* collapse newlines in agent command quoteShell to prevent tmux send-keys splitting ([#189](https://github.com/windmill-labs/webmux/issues/189)) ([fdec1ac](https://github.com/windmill-labs/webmux/commit/fdec1acba9134dde25bb1b202aef76fe5eb0667d))
* prevent Safari from closing branch selector before selection ([#188](https://github.com/windmill-labs/webmux/issues/188)) ([74bc422](https://github.com/windmill-labs/webmux/commit/74bc422bea4e339325d7720dc8c3bd1a161a833b))
* send creation status logs to stdout instead of stderr ([4aab7fb](https://github.com/windmill-labs/webmux/commit/4aab7fbb14270c2e0f92926c7629ee85f485518d))

## [0.22.1](https://github.com/windmill-labs/webmux/compare/v0.22.0...v0.22.1) (2026-03-25)


### Bug Fixes

* remove hardcoded fake-repo from linked repos ([#184](https://github.com/windmill-labs/webmux/issues/184)) ([4859a80](https://github.com/windmill-labs/webmux/commit/4859a80d34fabfd4881408f1526ba9a16db7265b))

## [0.22.0](https://github.com/windmill-labs/webmux/compare/v0.21.0...v0.22.0) (2026-03-25)


### Features

* show linked repos inline in sidebar ([#182](https://github.com/windmill-labs/webmux/issues/182)) ([fa1cb0f](https://github.com/windmill-labs/webmux/commit/fa1cb0f014491c513c642819834f5278846574a8))

## [0.21.0](https://github.com/windmill-labs/webmux/compare/v0.20.0...v0.21.0) (2026-03-25)


### Features

* add remote branch toggle for existing branches ([#176](https://github.com/windmill-labs/webmux/issues/176)) ([d55448e](https://github.com/windmill-labs/webmux/commit/d55448e2f1b4115a57cd35d4d9933dfb0b3dfd28))
* expand init starter template ([#174](https://github.com/windmill-labs/webmux/issues/174)) ([c4f022e](https://github.com/windmill-labs/webmux/commit/c4f022e475607a3b389215e48582ed60e98fc585))


### Bug Fixes

* preserve init template config comments ([#178](https://github.com/windmill-labs/webmux/issues/178)) ([c1c325d](https://github.com/windmill-labs/webmux/commit/c1c325dd20bbbb4129110ea9d939dbe83c29cf63))
* show remote toggle when no branches match in selector ([#180](https://github.com/windmill-labs/webmux/issues/180)) ([f767d3a](https://github.com/windmill-labs/webmux/commit/f767d3af1d9196019f28f565c50265d076d88dfc))
* wrap notification toast text ([#177](https://github.com/windmill-labs/webmux/issues/177)) ([9224da9](https://github.com/windmill-labs/webmux/commit/9224da9fb4b105216e0fd5ce1f5d4918e36076ec))

## [0.20.0](https://github.com/windmill-labs/webmux/compare/v0.19.0...v0.20.0) (2026-03-24)


### Features

* add `webmux send` CLI command ([#172](https://github.com/windmill-labs/webmux/issues/172)) ([4a915dc](https://github.com/windmill-labs/webmux/commit/4a915dc8e8e816a139e45641815242b9e71624c0))
* add auto-close on merge and auto-pull main ([#173](https://github.com/windmill-labs/webmux/issues/173)) ([c6ae6f1](https://github.com/windmill-labs/webmux/commit/c6ae6f1d69262180751fefcf0f4b105ac19c4c00))
* add command pane workingDir ([#169](https://github.com/windmill-labs/webmux/issues/169)) ([84fcb2e](https://github.com/windmill-labs/webmux/commit/84fcb2e2b5d609f76424c1f261b74dd6e4f9c701))
* add worktree base branch support ([#170](https://github.com/windmill-labs/webmux/issues/170)) ([8d9a04b](https://github.com/windmill-labs/webmux/commit/8d9a04b3f88704404f37cc96ee3f975d81db2c82))


### Bug Fixes

* fall back to python3 pty.spawn when script is not in PATH ([#166](https://github.com/windmill-labs/webmux/issues/166)) ([8188e5a](https://github.com/windmill-labs/webmux/commit/8188e5a0bbc569b2a75c5fbeaa72702d6ecc4002))
* include remote branches in worktree branch selector ([#171](https://github.com/windmill-labs/webmux/issues/171)) ([fe2948a](https://github.com/windmill-labs/webmux/commit/fe2948ad59a5d42270463d4c02b3e059845a093b))
* wrap topbar badges before action buttons ([#168](https://github.com/windmill-labs/webmux/issues/168)) ([2bace2f](https://github.com/windmill-labs/webmux/commit/2bace2f18f3aa7f651c40df653bff0e295aadcb7))

## [0.19.0](https://github.com/windmill-labs/webmux/compare/v0.18.0...v0.19.0) (2026-03-19)


### Features

* add --app flag for browser app mode ([#143](https://github.com/windmill-labs/webmux/issues/143)) ([62b68a8](https://github.com/windmill-labs/webmux/commit/62b68a8df0b8e3db8bd53cc45615e2584d4e1df5))
* add --detach/-d flag to webmux add command ([#159](https://github.com/windmill-labs/webmux/issues/159)) ([0e144f6](https://github.com/windmill-labs/webmux/commit/0e144f6d313a566a38388663bac505ee465ea938))
* add linear ticket worktree option ([#163](https://github.com/windmill-labs/webmux/issues/163)) ([e52caf5](https://github.com/windmill-labs/webmux/commit/e52caf5d7f8d53488a58382515425f0ddb961443))
* add native terminal launch endpoint ([#158](https://github.com/windmill-labs/webmux/issues/158)) ([11ff5aa](https://github.com/windmill-labs/webmux/commit/11ff5aa896dd4441c5a6724a0eb3143cce5a3bd2))
* auto-create worktrees for Linear tickets ([#160](https://github.com/windmill-labs/webmux/issues/160)) ([53afe95](https://github.com/windmill-labs/webmux/commit/53afe95b28df9104fd8965eb2e06a3054c36363e))


### Bug Fixes

* isolate terminal sessions and serialize sync ([#138](https://github.com/windmill-labs/webmux/issues/138)) ([31f4162](https://github.com/windmill-labs/webmux/commit/31f4162683da14299eb29b3cb670ad2ccf0de6b3))
* make linear badge static in worktree list ([#161](https://github.com/windmill-labs/webmux/issues/161)) ([000ad83](https://github.com/windmill-labs/webmux/commit/000ad83693158b36b51419a5712949118fafbbda))
* show linear panel without api key ([#164](https://github.com/windmill-labs/webmux/issues/164)) ([0c8965d](https://github.com/windmill-labs/webmux/commit/0c8965d6d60f2c5ed7419a744dcf7d689691c669))


### Performance

* increase github PR polling rate from 20s to 10s ([#162](https://github.com/windmill-labs/webmux/issues/162)) ([888d36c](https://github.com/windmill-labs/webmux/commit/888d36ca4e48c8aad05369ec4bf0a00ba8bbee5f))

## [0.18.0](https://github.com/windmill-labs/webmux/compare/v0.17.0...v0.18.0) (2026-03-18)


### Features

* add reusable Toggle component for boolean startup envs ([#154](https://github.com/windmill-labs/webmux/issues/154)) ([c748618](https://github.com/windmill-labs/webmux/commit/c7486188651aa59b82a8dcf440a882f8eaeb3045))
* close dialog on outside click ([#151](https://github.com/windmill-labs/webmux/issues/151)) ([908af94](https://github.com/windmill-labs/webmux/commit/908af94edb3d40c0d8adf22ae57d8ac84b32a07e))
* diff toggle, badge labels, and comment sorting ([#150](https://github.com/windmill-labs/webmux/issues/150)) ([a9fe654](https://github.com/windmill-labs/webmux/commit/a9fe654a87779078a587d234c31981afed06b83c))
* resizable worktree list sidebar panel ([#153](https://github.com/windmill-labs/webmux/issues/153)) ([bf7c4ba](https://github.com/windmill-labs/webmux/commit/bf7c4ba379a5293b62c58e2e988a1cfe3c36ad53))

## [0.17.0](https://github.com/windmill-labs/webmux/compare/v0.16.0...v0.17.0) (2026-03-17)


### Features

* allow worktreeRoot override from webmux.local.yaml ([#146](https://github.com/windmill-labs/webmux/issues/146)) ([241f39d](https://github.com/windmill-labs/webmux/commit/241f39d5916e34a118083987020a5188ba7a607e))
* dirty badge diff dialog ([#148](https://github.com/windmill-labs/webmux/issues/148)) ([4cd95dd](https://github.com/windmill-labs/webmux/commit/4cd95ddcc577e7a08c13563f05cb31dae5f61af1))
* show preview panel for closed worktrees instead of auto-opening ([#144](https://github.com/windmill-labs/webmux/issues/144)) ([9132c95](https://github.com/windmill-labs/webmux/commit/9132c95be6c92ebf15128554adb46b03cb5dda37))
* terminal drag-and-drop image upload ([#147](https://github.com/windmill-labs/webmux/issues/147)) ([3c78567](https://github.com/windmill-labs/webmux/commit/3c7856744e36a627b02f39bbfa9c197a6dadae6f))


### Bug Fixes

* add missing static/.assetsignore for cloudflare pages build ([dcf51ea](https://github.com/windmill-labs/webmux/commit/dcf51ea62eb5ae449722c1218ffd885e30c90749))
* add wrangler.toml for cloudflare pages deploy ([be35397](https://github.com/windmill-labs/webmux/commit/be35397fb5b9e7ab9ba4e23a1a2f7ca7141d99c2))
* filter ci logs to show only the selected check's job ([#145](https://github.com/windmill-labs/webmux/issues/145)) ([1114094](https://github.com/windmill-labs/webmux/commit/111409425701fd0ddefb59773e51e96fc80b57af))

## [0.16.0](https://github.com/windmill-labs/webmux/compare/v0.15.0...v0.16.0) (2026-03-13)


### Features

* persist last selected worktree ([#135](https://github.com/windmill-labs/webmux/issues/135)) ([62d82b9](https://github.com/windmill-labs/webmux/commit/62d82b9a367d787a5614beaf95ab42d8b7d87ea5))


### Bug Fixes

* keep selected worktree on create ([#136](https://github.com/windmill-labs/webmux/issues/136)) ([224c3a6](https://github.com/windmill-labs/webmux/commit/224c3a60e7a4fa16841f35c7a04599a32c3a7e72))
* truncate long worktree names in header ([#133](https://github.com/windmill-labs/webmux/issues/133)) ([8cec301](https://github.com/windmill-labs/webmux/commit/8cec30143ec9fc1ecb74573d5cba4c01821129e6))

## [0.15.0](https://github.com/windmill-labs/webmux/compare/v0.14.0...v0.15.0) (2026-03-12)


### Features

* add mobile more button for PR badges, CI, and comments ([#122](https://github.com/windmill-labs/webmux/issues/122)) ([f9a8c37](https://github.com/windmill-labs/webmux/commit/f9a8c37f3e15cd93779cbd8bfdf57b9ac5de489e))
* add settings icon with theme selection ([#130](https://github.com/windmill-labs/webmux/issues/130)) ([972e38e](https://github.com/windmill-labs/webmux/commit/972e38eff5581466429f2f850bbcb9bf0ee56e25))
* add webmux local yaml overlays ([#129](https://github.com/windmill-labs/webmux/issues/129)) ([37b005d](https://github.com/windmill-labs/webmux/commit/37b005d0aa9299523a18d2847222e12cb7827af8))
* group pr ci and comment badges ([#132](https://github.com/windmill-labs/webmux/issues/132)) ([f173bbf](https://github.com/windmill-labs/webmux/commit/f173bbf2148f9b365ce348ccf9d8b8e141068102))


### Bug Fixes

* harden tmux closed-session handling ([#128](https://github.com/windmill-labs/webmux/issues/128)) ([a9b941f](https://github.com/windmill-labs/webmux/commit/a9b941f385146cc0ca15df246553ee713ccf0289))
* reconnect terminal after idle disconnect ([#127](https://github.com/windmill-labs/webmux/issues/127)) ([9f107d0](https://github.com/windmill-labs/webmux/commit/9f107d071a5232eba1c903d80610b9d95ec431e6))
* resolve remove from linked worktree ([#125](https://github.com/windmill-labs/webmux/issues/125)) ([b0b1c70](https://github.com/windmill-labs/webmux/commit/b0b1c70d4b41aa75abfee4ff5cafc8c36e2319df))
* restore mobile agent pane scrolling ([#123](https://github.com/windmill-labs/webmux/issues/123)) ([d62f062](https://github.com/windmill-labs/webmux/commit/d62f0627c36ed25ecea8972ba57e34d0f8231c4b))
* switch to tmux window after webmux open ([#121](https://github.com/windmill-labs/webmux/issues/121)) ([6f6d0fa](https://github.com/windmill-labs/webmux/commit/6f6d0faa9023ebc672977190726c43bb353fb254))
* widen creation dialog and prompt input ([#126](https://github.com/windmill-labs/webmux/issues/126)) ([98ea7b1](https://github.com/windmill-labs/webmux/commit/98ea7b1d8e94bcb3fd3d0eafe1922fd8534f29ec))

## [0.14.0](https://github.com/windmill-labs/webmux/compare/v0.13.0...v0.14.0) (2026-03-11)


### Features

* notify changelog to discord on release ([365d73f](https://github.com/windmill-labs/webmux/commit/365d73f1e650db7720d43dad59e78efec20a12dd))

## [0.13.0](https://github.com/windmill-labs/webmux/compare/v0.12.0...v0.13.0) (2026-03-11)


### Features

* add existing branch worktree picker ([#119](https://github.com/windmill-labs/webmux/issues/119)) ([93e0bd8](https://github.com/windmill-labs/webmux/commit/93e0bd806b13eafecdc07d5cdc73272f631b48de))
* add webmux prune command ([#118](https://github.com/windmill-labs/webmux/issues/118)) ([eda234a](https://github.com/windmill-labs/webmux/commit/eda234a810e91209bf130eecc81e674be2d8edda))


### Bug Fixes

* isolate pane base index from user tmux config ([#115](https://github.com/windmill-labs/webmux/issues/115)) ([5308220](https://github.com/windmill-labs/webmux/commit/53082200e72ae1d8c2f84a653b26e9b4d59869ff))
* resume agent sessions on reopen ([#116](https://github.com/windmill-labs/webmux/issues/116)) ([6748292](https://github.com/windmill-labs/webmux/commit/6748292f20c197804842ac9f9eccf6c4c38f6b3c))

## [0.12.0](https://github.com/windmill-labs/webmux/compare/v0.11.0...v0.12.0) (2026-03-11)


### Features

* add --version / -V flag ([#101](https://github.com/windmill-labs/webmux/issues/101)) ([4d3e614](https://github.com/windmill-labs/webmux/commit/4d3e6147605a92d9f6fd6eeb2851e3697feeac1b))
* add shell autocompletion for CLI commands ([#100](https://github.com/windmill-labs/webmux/issues/100)) ([d08512d](https://github.com/windmill-labs/webmux/commit/d08512de69ba2b7315371ecbeeb49ecdd29eec2d))
* enforce 40-char max on auto-generated branch names ([#108](https://github.com/windmill-labs/webmux/issues/108)) ([10311f6](https://github.com/windmill-labs/webmux/commit/10311f65774fcdc6c43f9993cd17ba244eec2c6a))
* migrate site docs to sveltekit ([#113](https://github.com/windmill-labs/webmux/issues/113)) ([9b53372](https://github.com/windmill-labs/webmux/commit/9b53372bb69a628c999c231f5180652589228291))
* redesign header with per-repo rows and linked repo cursor button ([#104](https://github.com/windmill-labs/webmux/issues/104)) ([40e2256](https://github.com/windmill-labs/webmux/commit/40e225643eed3f99b9f9ab497e344b9f5728108a))
* show creating indicator in worktree list instead of blocking dialog ([#99](https://github.com/windmill-labs/webmux/issues/99)) ([c388ee5](https://github.com/windmill-labs/webmux/commit/c388ee562271b764cd058674b2b3bd5c0199bf9c))
* show creating worktree at top of list instead of bottom ([#103](https://github.com/windmill-labs/webmux/issues/103)) ([e3a8440](https://github.com/windmill-labs/webmux/commit/e3a8440264be54eb7ee6532d509307530e909916))
* surface backend worktree creation progress ([#112](https://github.com/windmill-labs/webmux/issues/112)) ([c193879](https://github.com/windmill-labs/webmux/commit/c193879fcfa9da350379c412a53f62d6d7ca968a))


### Bug Fixes

* append branch name to linked repo cursor URL path ([#107](https://github.com/windmill-labs/webmux/issues/107)) ([64a877a](https://github.com/windmill-labs/webmux/commit/64a877af585de98f5c8abb0b13e4725cfcd97d68))
* filter duplicate worktree entry while creating ([#105](https://github.com/windmill-labs/webmux/issues/105)) ([c64f670](https://github.com/windmill-labs/webmux/commit/c64f670021f8008bac08cadfe33bcca384dac829))
* force pane-base-index 0 on managed tmux sessions ([#98](https://github.com/windmill-labs/webmux/issues/98)) ([f326134](https://github.com/windmill-labs/webmux/commit/f326134abf4e26843d08ad87aea30628df2826b0))
* parse serve flags after subcommand ([#95](https://github.com/windmill-labs/webmux/issues/95)) ([a09918f](https://github.com/windmill-labs/webmux/commit/a09918fcb2d65094a2db9ccc3b2aa56ac0e24196))
* persist startupEnvs and checkbox state in save as default ([#109](https://github.com/windmill-labs/webmux/issues/109)) ([7b26564](https://github.com/windmill-labs/webmux/commit/7b26564d684b42bbd4d225103bb5eea771bc46ac))
* register zsh completion for webmux ([#102](https://github.com/windmill-labs/webmux/issues/102)) ([195822d](https://github.com/windmill-labs/webmux/commit/195822d7a1283e2bffecc646387ac4f4cb64a423))
* reload dotenv after post-create hook ([#111](https://github.com/windmill-labs/webmux/issues/111)) ([5402897](https://github.com/windmill-labs/webmux/commit/54028975c64214b0ac6462b7ff398fd843843ffa))
* resolve relative linked repo dir and support array github config ([#106](https://github.com/windmill-labs/webmux/issues/106)) ([43d80dd](https://github.com/windmill-labs/webmux/commit/43d80dd4e7ceab83b0cd54be8f0c38303c11bc58))
* restore claude hooks after post-create ([#114](https://github.com/windmill-labs/webmux/issues/114)) ([8ac4528](https://github.com/windmill-labs/webmux/commit/8ac4528635b06e861474375192efb74339a54f21))
* simplify worktree create loading state ([#110](https://github.com/windmill-labs/webmux/issues/110)) ([2fc6722](https://github.com/windmill-labs/webmux/commit/2fc67227f4c265cc264a06eca2fb5fe65836b318))

## [0.11.0](https://github.com/windmill-labs/webmux/compare/v0.10.1...v0.11.0) (2026-03-11)


### Features

* add `webmux serve` command, bare `webmux` now shows help ([#90](https://github.com/windmill-labs/webmux/issues/90)) ([e1ca9f5](https://github.com/windmill-labs/webmux/commit/e1ca9f5a7d2a0dcec8f37264bd861c17160a0ff8))
* add webmux update command ([#92](https://github.com/windmill-labs/webmux/issues/92)) ([3f64a25](https://github.com/windmill-labs/webmux/commit/3f64a258e641bd5ea25077c7d19593b12f22250c))
* use claude/codex CLI for auto-name instead of direct API calls ([#94](https://github.com/windmill-labs/webmux/issues/94)) ([5d313e8](https://github.com/windmill-labs/webmux/commit/5d313e81d08758cc940fc3e6229b3ecbd9ce0982))

## [0.10.1](https://github.com/windmill-labs/webmux/compare/v0.10.0...v0.10.1) (2026-03-10)


### Bug Fixes

* handle missing direnv binary in lifecycle hook runner ([#89](https://github.com/windmill-labs/webmux/issues/89)) ([d4f10d4](https://github.com/windmill-labs/webmux/commit/d4f10d4db8c7eab761dad562ba9385f774ebf287))

## [0.10.0](https://github.com/windmill-labs/webmux/compare/v0.9.0...v0.10.0) (2026-03-10)


### Features

* change default worktree root from __worktrees to ../worktrees ([dd4fbed](https://github.com/windmill-labs/webmux/commit/dd4fbed4bbb0daa4d30a6a302fe845ff8b36dcb3))
* inject .env.local into worktree runtime environment ([#86](https://github.com/windmill-labs/webmux/issues/86)) ([4d25f95](https://github.com/windmill-labs/webmux/commit/4d25f95d98fd6cc3d12ab525f733c8e87ee459c4))


### Bug Fixes

* probe both IPv4 and IPv6 in service port health check ([#87](https://github.com/windmill-labs/webmux/issues/87)) ([62eb812](https://github.com/windmill-labs/webmux/commit/62eb812d3d6b45be96fe5ac4b8b6f845e8551d5c))

## [0.9.0](https://github.com/windmill-labs/webmux/compare/v0.8.0...v0.9.0) (2026-03-10)


### Features

* add native webmux lifecycle commands ([#83](https://github.com/windmill-labs/webmux/issues/83)) ([41818f7](https://github.com/windmill-labs/webmux/commit/41818f7339b37620fd0e3b9d4c24d001bda3a011))
* add webmux list command and auto-attach tmux on add ([#85](https://github.com/windmill-labs/webmux/issues/85)) ([07c199d](https://github.com/windmill-labs/webmux/commit/07c199d87d77cad28f97c1b14513fce80edcc876))

## [0.8.0](https://github.com/windmill-labs/webmux/compare/v0.7.3...v0.8.0) (2026-03-10)


### Features

* enforce minimum bun version (&gt;= 1.3.5) during webmux init ([867ea63](https://github.com/windmill-labs/webmux/commit/867ea63c12fa637af5a75b63b709a294c8169f5a))


### Bug Fixes

* use direnv exec for lifecycle hooks to provide nix dev shell env ([#82](https://github.com/windmill-labs/webmux/issues/82)) ([3d0d2c5](https://github.com/windmill-labs/webmux/commit/3d0d2c516c9b634b0f670a84e0f0bb08fbca3dd8))

## [0.7.3](https://github.com/windmill-labs/webmux/compare/v0.7.2...v0.7.3) (2026-03-09)


### Bug Fixes

* avoid reopening removing worktrees ([cabbeac](https://github.com/windmill-labs/webmux/commit/cabbeac3df2af5d59b45d42b26efbee05cdcbf58))
* force remove worktrees from backend ([7e0f192](https://github.com/windmill-labs/webmux/commit/7e0f192d47e6034f94933475be0e06294f5eb26a))
* harden backend worktree removal ([a79e171](https://github.com/windmill-labs/webmux/commit/a79e1717d4fe3c2e7aec0160fcadcdbecc927c1d))
* run postcreate hook before tmux startup ([4ad6a73](https://github.com/windmill-labs/webmux/commit/4ad6a73f5fcb1dabc084073ca6b30897d97339aa))

## [0.7.2](https://github.com/windmill-labs/webmux/compare/v0.7.1...v0.7.2) (2026-03-06)


### Bug Fixes

* use python pty.spawn instead of script on macOS ([26aeeeb](https://github.com/windmill-labs/webmux/commit/26aeeeb3106a9c8e074be7ffefa6cd9606dadcff))

## [0.7.1](https://github.com/windmill-labs/webmux/compare/v0.7.0...v0.7.1) (2026-03-06)


### Bug Fixes

* use correct `script` command syntax on macOS ([4f3d5ef](https://github.com/windmill-labs/webmux/commit/4f3d5efd59e06810203bcbb7023cc06ecd2413b5))

## [0.7.0](https://github.com/windmill-labs/webmux/compare/v0.6.2...v0.7.0) (2026-03-04)


### Features

* generate .workmux.yaml with env-aware pane setup in init ([3cc608d](https://github.com/windmill-labs/webmux/commit/3cc608db4c4d19fbfc8e4307d35da0b602643094))
* uncomment services and add npm install in init templates ([2943df2](https://github.com/windmill-labs/webmux/commit/2943df27f3f360cdc339e3ea8753048e51c4c7da))


### Bug Fixes

* comment out services section in webmux template ([3967301](https://github.com/windmill-labs/webmux/commit/3967301fd4b6c2fe8b8b069b7e1b19991a86fdcb))

## [0.6.2](https://github.com/windmill-labs/webmux/compare/v0.6.1...v0.6.2) (2026-03-04)


### Performance

* reduce GitHub API usage by scoping PR polls to active worktrees ([5634a8e](https://github.com/windmill-labs/webmux/commit/5634a8e268f9aeaaba09f39667723bdc13254735))

## [0.6.1](https://github.com/windmill-labs/webmux/compare/v0.6.0...v0.6.1) (2026-03-04)


### Bug Fixes

* check for systemctl/launchctl before managing services ([61c9819](https://github.com/windmill-labs/webmux/commit/61c9819315202030b21d87f5e273dbdcbd2e39fd))

## [0.6.0](https://github.com/windmill-labs/webmux/compare/v0.5.0...v0.6.0) (2026-03-04)


### Features

* add `webmux init` onboarding command ([#65](https://github.com/windmill-labs/webmux/issues/65)) ([6e8b128](https://github.com/windmill-labs/webmux/commit/6e8b128785d716bf38cd1a3ea0d45f9837941ec3))
* add `webmux service` command for running as a system daemon ([#67](https://github.com/windmill-labs/webmux/issues/67)) ([39ba997](https://github.com/windmill-labs/webmux/commit/39ba99704482ea5bfb8567a632b741df3e6bb623))
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

* add debug log levels with --debug flag for webmux ([331ed1a](https://github.com/windmill-labs/workmux-web/commit/331ed1a0445869c2d187a872f61a532c52315227))
* move port allocation into webmux backend ([#34](https://github.com/windmill-labs/workmux-web/issues/34)) ([ade42fd](https://github.com/windmill-labs/workmux-web/commit/ade42fddecb27b350c548cc2c3146014ccf4b340))


### Bug Fixes

* add passwd entry for UID 1000 to fix "I have no name!" prompt ([#36](https://github.com/windmill-labs/workmux-web/issues/36)) ([9f8b871](https://github.com/windmill-labs/workmux-web/commit/9f8b871491574ca8f465027c88292132df4cbf46))
* correct repo URL to windmill-labs/workmux-web ([de35efe](https://github.com/windmill-labs/workmux-web/commit/de35efec763748bfa9dbb1b74c9ebb95ece278d0))
* replace autofocus attribute with use:action to resolve a11y warning ([cdf905d](https://github.com/windmill-labs/workmux-web/commit/cdf905d4730a9e8e7ea90265653d9329a6687175))
* terminal clipboard copy failing in non-secure contexts ([2a3a565](https://github.com/windmill-labs/workmux-web/commit/2a3a5655be81ad48da61f07140627ea4da2fbe7a))
