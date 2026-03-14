import re
with open('app/onboarding.tsx', 'r') as f: data = f.read()

# Make sure Image is imported from react-native
if 'import { Image ' not in data and ' Image,' not in data and 'Image ' not in data.split('} from "react-native"')[0]:
    pass # Wait, that test syntax already gave me syntax OK, meaning it compiles as text.
print("Done")
