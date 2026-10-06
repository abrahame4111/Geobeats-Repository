import { PermissionsAndroid, Platform, Alert } from 'react-native';

export const requestLocationPermission = async () => {
  if (Platform.OS === 'ios') {
    return true; // iOS permissions are handled automatically by react-native-geolocation-service
  }

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Location Access Required',
        message: 'Music Navigator needs access to your location to show you on the map and share your location with friends.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      },
    );

    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      console.log('Location permission granted');
      return true;
    } else {
      console.log('Location permission denied');
      Alert.alert(
        'Permission Required',
        'Location permission is required to use the map feature. Please enable it in your device settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Settings',
            onPress: () => {
              // You could open app settings here if needed
            },
          },
        ],
      );
      return false;
    }
  } catch (err) {
    console.warn('Permission error:', err);
    return false;
  }
};

export const checkLocationPermission = async () => {
  if (Platform.OS === 'ios') {
    return true;
  }

  try {
    const granted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return granted;
  } catch (err) {
    console.warn('Permission check error:', err);
    return false;
  }
};