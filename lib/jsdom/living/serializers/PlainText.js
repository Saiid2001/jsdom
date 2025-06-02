module.exports = {
    serialize: function (entryList, encoding = "UTF-8") {

        const parts = entryList.map((entry) => {
            if (typeof entry.value === "string") {
                return `${entry.name}=${entry.value}`;
            } else {
                throw new Error("HTMLFormElement._mutateActionURL: entry value must be a string");
            }
        });

        // Append a U+000D CARRIAGE RETURN (CR) U+000A LINE FEED (LF) character pair to result.
        return parts.length ? parts.join("\r\n") + "\r\n" : "";

    }
}