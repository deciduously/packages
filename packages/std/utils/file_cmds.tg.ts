import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";

export const metadata = {
	name: "file_cmds",
	version: "457.120.3",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:0a3f9b5bbf4dcd3d7a2f76f3fb4f0671eadaa0603341ef6be34796f847c9a5fa";
	const owner = "apple-oss-distributions";
	const repo = "file_cmds";
	const tag = std.download.packageName({ name, version });
	return std.download.fromGithub({
		checksum,
		source: "tag",
		owner,
		repo,
		tag,
	});
};

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

/** Produce an `install` executable that preserves xattrs on macOS, alongside the `xattr` command, to include with the coreutils. */
export const macOsXattrCmds = async (arg?: tg.Unresolved<Arg>) => {
	const resolved = await tg.resolve(arg);
	const build = resolved?.build ?? (await std.triple.host());
	const os = std.triple.os(build);

	// Assert that the system is macOS.
	if (os !== "darwin") {
		throw new Error(`fileCmds is only supported on macOS, detected ${os}.`);
	}

	const sourceDir = await source();

	let result = await tg.directory({
		bin: tg.directory(),
	});

	// install
	result = await compileUtil({
		...resolved,
		destDir: result,
		extraArgs: ["-UTARGET_OS_OSX"],
		fileName: "xinstall.c",
		utilSource: tg.Directory.expect(await sourceDir.get("install")),
		utilName: "install",
	});

	// xattr
	result = await compileUtil({
		...resolved,
		destDir: result,
		fileName: "xattr.c",
		utilSource: tg.Directory.expect(await sourceDir.get("xattr")),
		utilName: "xattr",
	});

	return result;
};

export default macOsXattrCmds;

type UtilArg = Arg & {
	destDir: tg.Directory;
	extraArgs?: Array<tg.Template.Arg>;
	fileName: string;
	utilSource: tg.Directory;
	utilName: string;
};

export const compileUtil = async (arg: UtilArg) => {
	tg.assert(arg.env);
	const build = arg.build ?? (await std.triple.host());
	const host = build;

	// Grab args.
	const { destDir, extraArgs = [], fileName, utilName, utilSource } = arg;

	// Compile the util.
	const util = await tg.build`
			cc -Oz ${tg.Template.join(" ", ...extraArgs)} -o $OUTPUT ${utilSource}/${fileName}`
		.env(std.env.arg(arg.env, { utils: false }))
		.host(host)
		.then(tg.File.expect);

	// Combine with destination.
	return tg.directory(destDir, {
		[`bin/${utilName}`]: util,
	});
};
