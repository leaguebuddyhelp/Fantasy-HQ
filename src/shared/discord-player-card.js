const { contractView, dollars } = require('./player-contract');
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

  const contract = player.contractView || contractView(player);
  if (player.contract || player.contractView) embed.addFields({ name: '💵 Contract', value: `${contract.short}\n${contract.seasons.map(row => `${row.season}: ${dollars(row.salary)}${row.option ? ` (${row.option === 'PLAYER' ? 'PO' : 'TO'})` : ''}`).join(' · ')}${contract.guaranteedTotal == null ? '' : `\nPublished guaranteed total: ${dollars(contract.guaranteedTotal)}`}`.slice(0, 1024) });
  if (player.tradeValueReason) embed.addFields({ name: 'Contract value impact', value: player.tradeValueReason.slice(0, 1024) });

  const files = [];
  if (player.portraitPath) {
    const candidate = path.resolve(player.portraitPath);
    const roots = ['../../data/2kratings/images', '../../draft_class/images'].map(root => path.resolve(__dirname, root) + path.sep);
    if (roots.some(root => candidate.startsWith(root)) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const real = fs.realpathSync(candidate);
      if (roots.some(root => real.startsWith(root))) {
        const name = `player-portrait${path.extname(real)}`;
        files.push(new AttachmentBuilder(real, { name })); embed.setThumbnail(`attachment://${name}`);
      }
    }
  }
  let slug;
  try { slug = new URL(player.profileUrl).pathname.split("/").filter(Boolean).pop(); } catch { }
  if (!files.length && slug && /^[a-z0-9-]+$/.test(slug)) {
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
