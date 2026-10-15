/*
 * This file is part of BlueMap, licensed under the MIT License (MIT).
 *
 * Copyright (c) Blue (Lukas Rieger) <https://bluecolored.de>
 * Copyright (c) contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
package de.bluecolored.bluemap.core.storage.file;

import de.bluecolored.bluemap.core.storage.OutputStreamAction;
import de.bluecolored.bluemap.core.storage.compression.Compression;
import de.bluecolored.bluemap.core.util.stream.FilepartTransaction;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.io.IOException;
import java.io.FilterOutputStream;
import static org.junit.jupiter.api.Assertions.*;

class TransactionalFileStorageTest {
    @TempDir Path directory;
    @Test void failedWriterCannotReplaceThePreviousTile() throws Exception {
        Path file = directory.resolve("tile");
        Files.writeString(file, "previous tile");
        var storage = new FileItemStorage(file, Compression.NONE, true);
        assertThrows(IOException.class, () -> storage.write((OutputStreamAction<IOException>) out -> {
            out.write("incomplete tile".getBytes(StandardCharsets.UTF_8));
            throw new IOException("injected writer failure");
        }));
        assertEquals("previous tile", Files.readString(file));
        try (var files = Files.list(directory)) { assertEquals(1, files.count()); }
    }
    @Test void successfulWriterAtomicallyReplacesTheTileAndRemovesItsPart() throws Exception {
        Path file = directory.resolve("tile");
        Files.writeString(file, "previous tile");
        var storage = new FileItemStorage(file, Compression.NONE, true);
        storage.write((OutputStreamAction<IOException>) out -> out.write("complete tile".getBytes(StandardCharsets.UTF_8)));
        assertEquals("complete tile", Files.readString(file));
        try (var files = Files.list(directory)) { assertEquals(1, files.count()); }
    }
    @Test void compressionCloseFailureCannotReplaceThePreviousTile() throws Exception {
        Path file = directory.resolve("tile");
        Files.writeString(file, "previous tile");
        try (var transaction = FilepartTransaction.create(file, out -> new FilterOutputStream(out) {
            @Override public void close() throws IOException {
                super.close();
                throw new IOException("injected compression close failure");
            }
        })) {
            transaction.out().write("partial compression frame".getBytes(StandardCharsets.UTF_8));
            assertThrows(IOException.class, transaction::commit);
        }
        assertEquals("previous tile", Files.readString(file));
        try (var files = Files.list(directory)) { assertEquals(1, files.count()); }
    }
    @Test void abandoningAWriteLeavesThePreviousTileIntact() throws Exception {
        Path file = directory.resolve("tile");
        Files.writeString(file, "previous tile");
        try (var transaction = FilepartTransaction.create(file)) {
            transaction.out().write("abandoned tile".getBytes(StandardCharsets.UTF_8));
        }
        assertEquals("previous tile", Files.readString(file));
        try (var files = Files.list(directory)) { assertEquals(1, files.count()); }
    }
}
