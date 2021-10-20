case "$(uname -s)" in
	Darwin)
		filesize() { stat -f %z "$1"; }
		checksum() { shasum -a 256 "$1" | cut -d' ' -f1; }
		alias sed='gsed'
	;;
	*)
		filesize() { stat -c %s "$1"; }
		checksum() { sha256sum "$1" | cut -d' ' -f1; }
	;;
esac
