const { brandTeamReply } = require("./team-branding");
const fs = require("fs");
const path = require("path");
const { AttachmentBuilder, EmbedBuilder } = require("discord.js");

function nbaPlayerCard(player, context) {
  const join = (values) => values.filter((value) => value != null && value !== "").join(" • ");
  const embed = new EmbedBuilder()
    .setTitle(`${player.name} • ${player.overall ?? "—"} OVR`)
    .setColor(0xffdc21)
    .setDescription([
      join([player.teamName || player.team || "Free Agent", join([player.position1, player.position2]).replace(" • ", "/")]),
      player.archetype,
    ].filter(Boolean).join("\n"))
    .setFooter({ text: context });
  const measurements = join([player.height, player.weightLbs ? `${player.weightLbs} lbs` : null, player.wingspan ? `${player.wingspan} wingspan` : null]);
  const background = join([player.nationality, player.yearsInNBA != null ? (Number(player.yearsInNBA) === 0 ? "Rookie" : `${player.yearsInNBA} yrs NBA`) : null, player.jerseyNumber != null ? `#${player.jerseyNumber}` : null]);
  if (measurements) embed.addFields({ name: "Size", value: measurements });
  if (background) embed.addFields({ name: "Profile", value: background });
  embed.addFields({ name: "League", value: `Age ${player.age ?? "—"} · Trade Value ${Number(player.tradeValue || 1).toLocaleString("en-US")}` });

  const files = [];
  let slug;
  try { slug = new URL(player.profileUrl).pathname.split("/").filter(Boolean).pop(); } catch { }
  if (slug && /^[a-z0-9-]+$/.test(slug)) {
    const root = path.resolve(__dirname, "../../data/2kratings/images");
    const local = ["png", "webp", "jpg", "jpeg"].map((extension) => path.join(root, `${slug}.${extension}`))
      .find((file) => fs.existsSync(file));
    if (local) {
      const name = `player-portrait${path.extname(local)}`;
      files.push(new AttachmentBuilder(local, { name }));
      embed.setThumbnail(`attachment://${name}`);
    }
  }
  if (!files.length && /^https?:\/\//i.test(player.imageUrl || "")) embed.setThumbnail(player.imageUrl);
  if (/^https?:\/\//i.test(player.profileUrl || "")) embed.setURL(player.profileUrl);
  return brandTeamReply({ embeds: [embed], files, attachments: [] }, player.teamName || player.team, true);
}

module.exports = { nbaPlayerCard };
