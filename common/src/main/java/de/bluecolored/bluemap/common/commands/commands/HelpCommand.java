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
package de.bluecolored.bluemap.common.commands.commands;

import de.bluecolored.bluecommands.annotations.Argument;
import de.bluecolored.bluecommands.annotations.Command;
import de.bluecolored.bluemap.common.commands.Unloaded;
import de.bluecolored.bluemap.common.plugin.Plugin;
import de.bluecolored.bluemap.common.serverinterface.CommandSource;
import lombok.RequiredArgsConstructor;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import java.util.List;
import java.util.ArrayList;
import static net.kyori.adventure.text.Component.text;

@RequiredArgsConstructor
public class HelpCommand {
    private final Plugin plugin;
    private record Entry(String form, String description, String permission, boolean staff) {}
    private static final List<Entry> ENTRIES = List.of(
            new Entry("help [page]", "show permitted commands", "bluemap.help", false),
            new Entry("maps", "list configured maps", "bluemap.maps", false),
            new Entry("version", "show plugin and Minecraft versions", "bluemap.version", false),
            new Entry("status", "show render status", "bluemap.status", true),
            new Entry("start", "start rendering", "bluemap.start", true),
            new Entry("stop", "pause rendering", "bluemap.stop", true),
            new Entry("reload", "reload configuration and resources", "bluemap.reload", true),
            new Entry("reload light", "reload lightweight settings", "bluemap.reload.light", true),
            new Entry("update <map> [x z radius]", "update changed tiles", "bluemap.update", true),
            new Entry("fix-edges <map> [x z radius]", "repair map tile edges", "bluemap.update", true),
            new Entry("force-update <map> [x z radius]", "render every selected tile", "bluemap.update", true),
            new Entry("freeze <map>", "freeze map updates", "bluemap.freeze", true),
            new Entry("unfreeze <map>", "resume map updates", "bluemap.unfreeze", true),
            new Entry("tasks", "show queued render tasks", "bluemap.tasks", true),
            new Entry("tasks cancel <task-ref|all>", "cancel queued render tasks", "bluemap.tasks.cancel", true),
            new Entry("storages [storage]", "inspect map storage", "bluemap.storages", true),
            new Entry("storages <storage> delete <map>", "delete a stored map", "bluemap.storages.delete", true),
            new Entry("purge <map>", "delete all rendered tiles for a map", "bluemap.purge", true),
            new Entry("troubleshoot [map] [x z]", "inspect map rendering problems", "bluemap.troubleshoot", true),
            new Entry("debug dump", "write a diagnostic state dump", "bluemap.debug.dump", true),
            new Entry("debug world [map] [x y z]", "inspect world data", "bluemap.debug.world", true),
            new Entry("debug map [map] [x z]", "inspect rendered map data", "bluemap.debug.map", true));

    @Command("") @Unloaded
    public Component root(CommandSource source) { return show(source, "1"); }
    @Command("help") @Unloaded
    public Component help(CommandSource source) { return show(source, "1"); }
    @Command("help <page>") @Unloaded
    public Component helpPage(CommandSource source, @Argument("page") String page) { return show(source, page); }

    public static Component show(CommandSource source, String requested) {
        List<Entry> ordinary = ENTRIES.stream().filter(entry -> !entry.staff() && source.hasPermission(entry.permission())).toList();
        List<Entry> staff = ENTRIES.stream().filter(entry -> entry.staff() && source.hasPermission(entry.permission())).toList();
        boolean directStaff = requested.equalsIgnoreCase("staff");
        if ((ordinary.isEmpty() && staff.isEmpty()) || (directStaff && staff.isEmpty()))
            return text("You do not have permission to use these commands.", NamedTextColor.RED);
        int ordinaryPages = (ordinary.size() + 7) / 8;
        int total = ordinaryPages + (staff.size() + 7) / 8;
        int page = 1;
        try { page = Integer.parseInt(requested); } catch (NumberFormatException ignored) { }
        page = Math.max(1, Math.min(total, directStaff ? ordinaryPages + 1 : page));
        boolean staffPage = page > ordinaryPages;
        List<Entry> section = staffPage ? staff : ordinary;
        int offset = ((staffPage ? page - ordinaryPages : page) - 1) * 8;
        List<Component> lines = new ArrayList<>();
        Component header = text("  ---------- ", NamedTextColor.DARK_GRAY)
                .append(text("BlueMap" + (staffPage ? " Staff" : ""), NamedTextColor.GREEN));
        if (total > 1) header = header.append(text(" (", NamedTextColor.DARK_GRAY)).append(text(page, NamedTextColor.WHITE))
                .append(text("/", NamedTextColor.DARK_GRAY)).append(text(total, NamedTextColor.WHITE))
                .append(text(")", NamedTextColor.DARK_GRAY));
        lines.add(header.append(text(" ----------", NamedTextColor.DARK_GRAY)));
        for (Entry entry : section.subList(offset, Math.min(section.size(), offset + 8)))
            lines.add(text("/bluemap " + entry.form(), NamedTextColor.GREEN).append(text(" - ", NamedTextColor.DARK_GRAY))
                    .append(text(entry.description(), NamedTextColor.GRAY)));
        lines.add(page < total ? text("  ---------- ", NamedTextColor.DARK_GRAY)
                .append(text("/bluemap help " + (page + 1), NamedTextColor.GREEN))
                .append(text(" for more", NamedTextColor.GRAY)).append(text(" ----------", NamedTextColor.DARK_GRAY))
                : text("  ----------------------------------------", NamedTextColor.DARK_GRAY));
        return Component.join(net.kyori.adventure.text.JoinConfiguration.newlines(), lines);
    }
}
