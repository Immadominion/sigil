import re

with open('app/onboarding.tsx', 'r') as f:
    data = f.read()

# Replace import
data = re.sub(r'import\s+\{\s*Hexagon.*?\}\s*from\s*["\']lucide-react-native["\'];?\n', '', data)
if 'import { Image ' not in data and 'import { ' in data:
    data = re.sub(r'import\s+\{([^}]+)\}\s*from\s*["\']react-native["\']', r'import { \1, Image } from "react-native"', data, count=1)

# Replace <Hexagon ... /> usage
data = re.sub(r'<Hexagon[^>]+>', r'<Image source={require("../assets/images/logo.png")} style={{ width: 64, height: 64, marginBottom: 16 }} resizeMode="contain" />', data)

with open('app/onboarding.tsx', 'w') as f:
    f.write(data)

print("Done")
