import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as readline from "readline" with { path: "../readline" };
import * as std from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://www.sqlite.org/",
	name: "sqlite",
	license: "https://sqlite.org/src/file?name=LICENSE.md&ci=trunk",
	repository: "https://www.sqlite.org/src/",
	version: "3.49.1",
	provides: {
		binaries: ["sqlite3"],
		headers: ["sqlite3.h"],
		libraries: ["sqlite3"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:106642d8ccb36c5f7323b64e4152e9b719f7c0215acf5bfeac3d5e7f97b59254";
	const extension = ".tar.gz";

	const produceVersion = (version: string) => {
		const [major, minor, patch] = version.split(".");
		tg.assert(major);
		tg.assert(minor);
		tg.assert(patch);
		return `${major}${minor.padEnd(3, "0")}${patch.padEnd(3, "0")}`;
	};

	const packageName = `${name}-autoconf-${produceVersion(version)}`;
	const base = `https://www.sqlite.org/2025`;
	return std.download
		.extractArchive({ checksum, base, packageName, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		ncurses?: std.args.OptionalDependencyArg<ncurses.Arg>;
		readline?: std.args.OptionalDependencyArg<readline.Arg>;
		zlib?: std.args.OptionalDependencyArg<zlib.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: tg.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const dependencies = [
		std.env.runtimeDependency(ncurses.build, dependencyArgs.ncurses),
		std.env.runtimeDependency(readline.build, dependencyArgs.readline),
		std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
	];

	const env = std.env.arg(
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
