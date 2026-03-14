const fs = require("fs");
let code = fs.readFileSync("app/(tabs)/index.tsx", "utf8");

code = code.replace(
  '<Wallet size={28} color="#FF4500" strokeWidth={2.5} />',
  '<Image source={require("../../assets/images/logo.png")} style={{ width: 28, height: 28 }} resizeMode="contain" />'
);

code = code.replace(
  '<Text style={{ color: "#F5F5F5", fontSize: 20, fontWeight: "800", letterSpacing: -0.5 }}>Sigil</Text>',
  '<Text style={{ color: "#F5F5F5", fontSize: 22, fontWeight: "400", letterSpacing: 1, fontFamily: Platform.OS === "ios" ? "Georgia" : "serif" }}>Sigil</Text>'
);

fs.writeFileSync("app/(tabs)/index.tsx", code);
