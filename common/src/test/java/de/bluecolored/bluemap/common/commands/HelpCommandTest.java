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
package de.bluecolored.bluemap.common.commands;
import de.bluecolored.bluemap.common.commands.commands.HelpCommand;
import de.bluecolored.bluemap.common.serverinterface.CommandSource;
import de.bluecolored.bluecommands.ParseResult;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.TextComponent;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class HelpCommandTest {
    private static final class Source implements CommandSource {
        private final Set<String> grants;
        private final List<Component> output = new ArrayList<>();
        Source(String... grants) { this.grants = Set.of(grants); }
        public boolean hasPermission(String permission) { return grants.contains(permission); }
        public void sendMessage(Component message) { output.add(message); }
    }
    private static String plain(Component component) {
        return (component instanceof TextComponent text ? text.content() : "")
                + component.children().stream().map(HelpCommandTest::plain).collect(java.util.stream.Collectors.joining());
    }
    @Test void actualRootAndHelpHandlersSeparateStaffAndClamp() {
        var source = new Source("bluemap.help", "bluemap.maps", "bluemap.reload");
        var help = new HelpCommand(null);
        String first = plain(help.root(source));
        assertTrue(first.contains("/bluemap maps"));
        assertFalse(first.contains("reload"));
        String last = plain(help.helpPage(source, "99"));
        assertTrue(last.contains("BlueMap Staff"));
        assertTrue(last.contains("reload"));
        assertFalse(last.contains("/bluemap maps"));
        assertFalse(last.contains("for more"));
        assertEquals(first, plain(help.helpPage(source, "banana")));
        assertEquals(first, plain(help.helpPage(source, "0")));
    }
    @Test void parserIndependentlyRejectsDeniedExecutionAndUnknownPrintsHelp() {
        var source = new Source("bluemap.help");
        var tree = Commands.create(null);
        assertTrue(tree.parse(source, "bluemap stop").getMatches().isEmpty());
        assertFalse(tree.parse(source, "bluemap help").getMatches().isEmpty());
        new CommandExecutor(null).execute(new ParseResult<>(source, "bluemap nonsense"));
        assertEquals(2, source.output.size());
        assertTrue(plain(source.output.getFirst()).contains("Unknown"));
        assertTrue(plain(source.output.getLast()).contains("/bluemap help"));
    }
    @Test void directStaffDenialAndStaffOnlyHaveNoEmptyOrdinaryPage() {
        var help = new HelpCommand(null);
        assertTrue(plain(help.helpPage(new Source("bluemap.help"), "staff")).contains("permission"));
        assertTrue(plain(help.root(new Source("bluemap.stop"))).contains("BlueMap Staff"));
        assertFalse(plain(help.root(new Source("bluemap.stop"))).contains("for more"));
    }
}
