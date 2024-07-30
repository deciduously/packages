import * as bootstrap from "../bootstrap.tg.ts";
import { mergeLibDirs } from "../sdk.tg.ts";
import * as std from "../tangram.tg.ts";
import { interpreterName } from "./libc.tg.ts";
import { defaultGlibcVersion } from "./libc/glibc.tg.ts";
import * as dependencies from "./dependencies.tg.ts";

export { toolchain, crossToolchain } from "./gcc/toolchain.tg.ts";

export let metadata = {
	homepage: "https://gcc.gnu.org/",
	license: "GPL-3.0-or-later",
	name: "gcc",
	repository: "https://gcc.gnu.org/git.html",
	version: "14.1.0",
};

/** Produce a GCC source directory with the gmp, mpfr, isl, and mpc sources optionally included. */
export let source = tg.target((bundledSources?: boolean) => {
	let { name, version } = metadata;

	// Download and unpack the GCC source.
	let extension = ".tar.xz";
	let checksum =
		"sha256:e283c654987afe3de9d8080bc0bd79534b5ca0d681a73a11ff2b5d3767426840";
	let base = `https://mirrors.ocf.berkeley.edu/gnu/${name}/${name}-${version}`;
	let sourceDir = std
		.download({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);

	// If requested, include the bundled sources as subdirectories.
	if (bundledSources) {
		sourceDir = tg.directory(sourceDir, {
			gmp: dependencies.gmp.source(),
			isl: dependencies.isl.source(),
			mpfr: dependencies.mpfr.source(),
			mpc: dependencies.mpc.source(),
		});
	}
	return sourceDir;
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	/** If this is true, add the gmp,mpfr, mpc, and isl source directories to the GCC source and build them all together. If false, these libraries must be available for the host in the env. */
	bundledSources?: boolean;
	env?: std.env.Arg;
	host?: string;
	/** If set, any directory here will be copied to $OUTPUT, and $OUTPUT/bin will be added to PATH before configuring. */
	populatePrefix?: tg.Directory | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
	sysroot: tg.Directory;
	target?: string;
	variant: Variant;
};
export type Variant =
	| "stage1_bootstrap" // C only, no libraries. Will produce an output directory with two folders, $OUTPUT/prefix with the installed compiler and $OUTPUT/build with the build artifacts.
	| "stage1_limited" // Produce a complete native `host === target` GCC toolchain with only C and C++ enabled and many features disabled.
	| "stage2_full"; // Everything enabled.

/* Produce a GCC toolchain capable of compiling C and C++ code. */
export let build = tg.target(async (arg: Arg) => {
	let {
		autotools = {},
		build: build_,
		bundledSources = false,
		env: env_,
		host: host_,
		populatePrefix,
		sdk,
		source: source_,
		sysroot,
		target: target_,
		variant,
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let target = target_ ?? host;

	let prefixPath = undefined;

	// Configure sysroot.
	let isCross = host !== target;
	let targetPrefix = isCross ? `${target}-` : "";
	let sysrootSubdir = isCross ? `/${target}` : "";
	let sysrootDir = tg`${sysroot}${sysrootSubdir}`;

	// Set up configuration.
	let preConfigureHook: tg.Unresolved<tg.Template.Arg> = "mkdir -p $OUTPUT";
	let configureArgs = [
		"--disable-bootstrap",
		"--disable-dependency-tracking",
		"--disable-nls",
		"--disable-multilib",
		"--enable-host-bind-now",
		"--enable-host-pie",
		`--build=${build}`,
		`--host=${host}`,
		`--target=${target}`,
		"--with-native-system-header-dir=/include",
		tg`--with-sysroot=${sysrootDir}`,
	];
	let configureCommand = undefined;
	let installPhase = undefined;

	if (populatePrefix) {
		preConfigureHook = tg.Template.join(
			"\n",
			preConfigureHook,
			tg`cp -R ${arg.populatePrefix}/* $OUTPUT\nchmod -R u+w $OUTPUT\nexport PATH=$OUTPUT/bin:$PATH`,
		);
	}

	// Set up containers to collect additional arguments and environment variables for specific configurations.
	let envArgs: tg.Unresolved<Array<std.env.Arg>> = [env_];

	// For Musl targets, disable libsanitizer regardless of build configuration. See https://wiki.musl-libc.org/open-issues.html
	let targetEnvironment = std.triple.environment(target);
	if (targetEnvironment === "musl") {
		configureArgs.push("--disable-libsanitizer");
	}

	// On GLIBC hosts, enable cxa_atexit.
	let hostEnvironment = std.triple.environment(host);
	if (hostEnvironment === "gnu") {
		configureArgs.push("--enable-__cxa_atexit");
	}

	let sourceDir = source_ ?? source(bundledSources);

	if (variant === "stage1_bootstrap") {
		configureArgs = configureArgs.concat([
			"--disable-libatomic",
			"--disable-libgomp",
			"--disable-libquadmath",
			"--disable-libsanitizer",
			"--disable-libssp",
			"--disable-libstdcxx",
			"--disable-libvtv",
			"--disable-shared",
			"--disable-threads",
			"--disable-werror",
			"--enable-languages=c,c++",
			"--with-newlib",
			"--without-headers",
		]);
		if (hostEnvironment === "gnu") {
			configureArgs.push(`--with-glibc-version=${defaultGlibcVersion}`);
		}
		installPhase = {
			post: tg`cat ${sourceDir}/gcc/limitx.h ${sourceDir}/gcc/glimits.h ${sourceDir}/gcc/limity.h > $(dirname $($OUTPUT/bin/${target}-gcc -print-libgcc-file-name))/include/limits.h`,
		};
	}

	if (variant === "stage1_limited") {
		configureArgs = configureArgs.concat([
			"--disable-libatomic",
			"--disable-libgomp",
			"--disable-libssp",
			"--disable-libvtv",
			"--enable-default-pie",
			"--enable-default-ssp",
			"--enable-initfini-array",
			tg`LDFLAGS_FOR_TARGET=-L$PWD/${target}/libgcc`,
			tg`--with-build-sysroot=${sysrootDir}`,
		]);
	}

	if (variant === "stage2_full") {
		configureArgs = configureArgs.concat([
			"--enable-default-ssp",
			"--enable-default-pie",
			"--enable-initfini-array",
			tg`LDFLAGS_FOR_TARGET="-Wl,-dynamic-linker,${sysrootDir}/lib/${interpreterName(
				target,
			)} -Wl,-rpath,${sysrootDir}/lib"`,
		]);
	}

	// Set up phases.
	let configureBody: tg.Unresolved<std.phases.CommandArgObject> = {
		args: configureArgs,
	};
	if (configureCommand !== undefined) {
		configureBody.command = configureCommand;
	}
	let configure = {
		pre: preConfigureHook,
		body: configureBody,
	};
	let phases: tg.Unresolved<std.phases.Arg> = { configure };
	if (installPhase !== undefined) {
		phases.install = installPhase;
	}

	let env = std.env.arg(envArgs);

	let result = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			defaultCrossArgs: false,
			defaultCrossEnv: false,
			env,
			prefixPath,
			phases,
			opt: "3",
			sdk,
			source: sourceDir,
		},
		autotools,
	);

	result = await mergeLibDirs(result);

	// Add cc symlinks.
	result = await tg.directory(result, {
		[`bin/${targetPrefix}cc`]: tg.symlink(`./${targetPrefix}gcc`),
	});
	if (!isCross) {
		result = await tg.directory(result, {
			[`bin/${host}-cc`]: tg.symlink(`./${host}-gcc`),
		});
	}

	return result;
});

export default build;

export let libPath = "lib";

export let linkerPath = (triple: string) => `${triple}/bin/ld`;

export let crossLinkerPath = (target: string) => `${target}/bin/ld`;

export { interpreterName } from "./libc.tg.ts";

export let interpreterPath = (host: string) =>
	`${libPath}/${interpreterName(host)}`;

type WrapArgsArg = {
	host: string;
	target?: string;
	toolchainDir: tg.Directory;
};

/** Produce the set of flags required to enable proxying a statically-linked toolchain dir. */
export let wrapArgs = async (arg: WrapArgsArg) => {
	let { host, target: target_, toolchainDir } = arg;
	let target = target_ ?? host;
	let hostOs = std.triple.os(host);
	let gccVersion = await getGccVersion(toolchainDir, host, target);
	let isCross = host !== target;
	let sysroot =
		hostOs === "darwin"
			? tg`${toolchainDir}/${target}/sysroot`
			: isCross
			  ? tg`${toolchainDir}/${target}`
			  : toolchainDir;

	let ccArgs = [
		tg`--sysroot=${sysroot}`,
		tg`-B${toolchainDir}/lib/gcc/${target}/${gccVersion}`,
		tg`-B${toolchainDir}/libexec/gcc/${target}/${gccVersion}`,
	];

	// On Darwin, include the target tools bin dir as well.
	if (hostOs === "darwin") {
		ccArgs.push(tg`-B${toolchainDir}/${target}/bin`);
	}

	let fortranArgs = ccArgs;

	let cxxHeaderRoot =
		hostOs === "darwin" ? tg`${toolchainDir}/${target}` : sysroot;
	let cxxArgs = [
		...ccArgs,
		tg`-isystem${cxxHeaderRoot}/include/c++/${gccVersion}`,
		tg`-isystem${cxxHeaderRoot}/include/c++/${gccVersion}/${target}`,
	];

	return { ccArgs, cxxArgs, fortranArgs };
};

async function getGccVersion(
	env: std.env.Arg,
	host: string,
	target?: string,
): Promise<string> {
	let targetTriple = target ?? host;
	let targetPrefix = host === targetTriple ? `` : `${targetTriple}-`;
	await std.env.assertProvides({ env, name: `${targetPrefix}gcc` });
	let script = tg`${targetPrefix}gcc --version | awk '/^${targetPrefix}gcc / {print $3}' > $OUTPUT`;
	// We always need an `awk`, but don't care where it comes from. Users should be able to just provide a toolchain dir and have this target work.
	let envObject = std.env.arg(bootstrap.utils(), env);
	let result = tg.File.expect(
		await (await tg.target(script, { env: envObject })).output(),
	);
	return (await result.text()).trim();
}
