import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import { buildSysroot } from "../gcc/toolchain.tg.ts";
import { interpreterName } from "../libc/glibc.tg.ts";
import make from "./make.tg.ts";
import pkgconfig from "./pkg_config.tg.ts";

export let metadata = {
	name: "ncurses",
	version: "6.4",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:6931283d9ac87c5073f30b6290c4c75f21632bb4fc3603ac8100812bed248159";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};

	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let build = build_ ? std.triple(build_) : host;

	let configure = {
		args: [
			"--with-shared",
			"--with-cxx-shared",
			"--without-debug",
			"--enable-widec",
			"--enable-pc-files",
			`--with-pkg-config-libdir="$OUTPUT/lib/pkgconfig"`,
			"--enable-symlinks",
			"--disable-home-terminfo",
			"--disable-rpath-hack",
		],
	};

	let fixup = `
				chmod -R u+w \${OUTPUT}
				for lib in ncurses form panel menu ; do
					rm -vf                     \${OUTPUT}/lib/lib\${lib}.so
					echo "INPUT(-l\${lib}w)" > \${OUTPUT}/lib/lib\${lib}.so
					ln -sfv \${lib}w.pc        \${OUTPUT}/lib/pkgconfig/\${lib}.pc
				done
				cd $OUTPUT
				rm -vf                     \${OUTPUT}/lib/libcursesw.so
				echo "INPUT(-lncursesw)" > \${OUTPUT}/lib/libcursesw.so
				ln -sfv libncurses.so      \${OUTPUT}/lib/libcurses.so
		`;
	let phases = { configure, fixup };

	// Locate toolchain interpreter and libdir.
	let muslArtifact = await bootstrap.musl.build({ host });
	let ldso = tg.File.expect(
		await muslArtifact.get(bootstrap.musl.interpreterPath(host)),
	);

	let env = [
		std.utils.env(arg),
		make(arg),
		pkgconfig(arg),
		{
			LDFLAGS: tg.Mutation.templatePrepend(
				tg`-Wl,-dynamic-linker,${ldso} -Wl,-rpath,'\$$ORIGIN/../lib'`,
				" ",
			),
			TANGRAM_LINKER_PASSTHROUGH: "1",
		},
		env_,
	];

	return std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	let binaries = [
		"captoinfo",
		"clear",
		"infocmp",
		"infotocap",
		"reset",
		"tabs",
		"tic",
		"toe",
		"tput",
		"tset",
	].map((bin) => {
		return { name: bin, testArgs: ["-V"] };
	});
	await std.assert.pkg({
		directory,
		binaries,
		libs: ["ncursesw", "formw", "menuw", "panelw"],
		metadata,
	});
	return directory;
});
